"""Resolve episode identities and discover public Japanese/English subtitle files."""

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass, replace
from html.parser import HTMLParser
from pathlib import PurePosixPath
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit

from yomiru.network import HttpClient, ProviderError, validate_url

KITSUNEKKO = "https://kitsunekko.net/"
OPEN_SUBTITLES = "https://opensubtitles-v3.strem.io"
TEXT_SUFFIXES = {".srt", ".ass", ".ssa"}


def normalized(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in text if c.isalnum())


@dataclass(frozen=True)
class Episode:
    video_id: str
    media_type: str
    titles: tuple[str, ...]
    season: int
    number: int
    year: int = 0
    season_specific: bool = False


@dataclass(frozen=True)
class Candidate:
    provider: str
    language: str
    url: str
    filename: str
    member: str = ""
    evidence: str = "episode identity; timing unverified"


def anilist(client: HttpClient, variables: dict) -> dict:
    fields = "id title{romaji english native} synonyms seasonYear format"
    query = (
        "query($search:String,$id:Int,$idMal:Int){"
        f"Media(search:$search,id:$id,idMal:$idMal,type:ANIME){{{fields}}}" + "}"
    )
    data = client.json(
        "https://graphql.anilist.co", ttl=86400, payload={"query": query, "variables": variables}
    )
    media = data.get("data", {}).get("Media") if isinstance(data, dict) else None
    if not isinstance(media, dict) or not isinstance(media.get("title"), dict):
        raise ProviderError("Anime metadata is unavailable")
    return media


def media_titles(media: dict) -> tuple[str, ...]:
    values = [*media.get("title", {}).values(), *media.get("synonyms", [])]
    return tuple(dict.fromkeys(s for s in values if isinstance(s, str) and s.strip()))


def resolve_episode(client: HttpClient, video_id: str, media_type: str) -> Episode:
    if media_type not in {"movie", "series"}:
        raise ProviderError("Only movie and series episode identities are supported")
    if match := re.fullmatch(r"(tt\d{5,12})(?::(\d{1,3}):(\d{1,4}))?", video_id):
        identity, season, number = match.groups()
        if media_type == "series" and (season is None or int(season) < 1 or int(number) < 1):
            raise ProviderError("Series discovery requires a season and episode")
        meta = client.json(
            f"https://v3-cinemeta.strem.io/meta/{media_type}/{identity}.json", ttl=86400
        ).get("meta", {})
        title = meta.get("name")
        if not isinstance(title, str) or not title.strip():
            raise ProviderError("Episode metadata is unavailable")
        year_match = re.search(r"\d{4}", str(meta.get("year", meta.get("released", ""))))
        return Episode(
            video_id,
            media_type,
            (title,),
            int(season or 1),
            int(number or 1),
            int(year_match[0]) if year_match else 0,
        )
    if match := re.fullmatch(r"(anilist|mal|kitsu):(\d{1,9})(?::(\d{1,4}))?", video_id):
        source, identity, number = match.groups()
        if media_type == "series" and (number is None or int(number) < 1):
            raise ProviderError("Anime discovery requires an episode number")
        if source == "kitsu":
            attributes = client.json(f"https://kitsu.io/api/edge/anime/{identity}", ttl=86400)
            attributes = attributes.get("data", {}).get("attributes", {})
            titles = tuple(s for s in attributes.get("titles", {}).values() if isinstance(s, str))
        else:
            titles = media_titles(
                anilist(client, {"id" if source == "anilist" else "idMal": int(identity)})
            )
        if not titles:
            raise ProviderError("Anime metadata is unavailable")
        return Episode(video_id, media_type, titles, 1, int(number or 1), season_specific=True)
    raise ProviderError("Unsupported episode ID; use an IMDb, Kitsu, AniList or MAL catalog")


def with_aliases(client: HttpClient, episode: Episode) -> Episode:
    """Accept search aliases only after exact title and year verification."""
    if episode.season_specific:
        return episode
    query = (
        "query($search:String){Page(perPage:10){media(search:$search,type:ANIME){"
        "id title{romaji english native} synonyms seasonYear format}}}"
    )
    data = client.json(
        "https://graphql.anilist.co",
        ttl=86400,
        payload={"query": query, "variables": {"search": episode.titles[0]}},
    )
    records = data.get("data", {}).get("Page", {}).get("media", [])
    matches = []
    for media in records:
        aliases = media_titles(media)
        if not ({normalized(s) for s in episode.titles} & {normalized(s) for s in aliases}):
            continue
        if episode.year and media.get("seasonYear") != episode.year:
            continue
        matches.append(aliases)
    if len(matches) != 1:
        return episode
    return replace(episode, titles=tuple(dict.fromkeys((*episode.titles, *matches[0]))))


class Links(HTMLParser):
    def __init__(self, text: str):
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.href = ""
        self.label = ""
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href", "")
            self.label = ""

    def handle_data(self, data):
        if self.href:
            self.label += data

    def handle_endtag(self, tag):
        if tag == "a" and self.href:
            self.links.append((self.href, self.label.strip()))
            self.href = ""


def episode_matches(filename: str, episode: Episode, *, seasonal_folder: bool = False) -> bool:
    name = unicodedata.normalize("NFKC", PurePosixPath(filename).name)
    if re.search(r"(?i)(?:^|[ ._\-\[])(?:op|ed|ncop|nced|signs|songs)(?:\d|[ ._\-\]]|$)", name):
        return False
    if explicit := re.search(r"(?i)s(\d{1,3})[ ._-]*e(\d{1,4})(?!\d)", name):
        return (int(explicit[1]), int(explicit[2])) == (episode.season, episode.number)
    if episode.media_type == "movie":
        return True
    if episode.season > 1 and not (episode.season_specific or seasonal_folder):
        return False  # Never guess absolute numbering across TV seasons.
    if japanese := re.search(r"第\s*(\d{1,4})\s*[話回]", name):
        return int(japanese[1]) == episode.number
    # Prefer the conventional title - 01 filename field over digits in a show title.
    numbers = re.findall(r"\s-\s*(\d{1,4})(?:v\d)?(?=[ ._\-\[\](]|$)", name)
    if not numbers:
        numbers = re.findall(r"(?:^|[ ._\-\[])(\d{1,4})(?:v\d)?(?=[ ._\-\[\](]|$)", name)
        numbers = [
            n
            for n in numbers
            if int(n) not in {480, 576, 720, 1080, 1920, 2160} and not 1900 <= int(n) <= 2099
        ]
    return bool(numbers) and int(numbers[-1]) == episode.number


def release_score(name: str, filename: str) -> int:
    def tokens(value):
        return set(re.findall(r"[a-z0-9]{3,}", value.casefold()))

    score = len(tokens(name) & tokens(filename))
    if "directorscut" in normalized(name) and "directorscut" not in normalized(filename):
        score -= 20
    for family in ("netflix", "nf", "bluray", "bdrip", "webrip", "webdl"):
        if family in normalized(name) and family in normalized(filename):
            score += 10
    return score


def archive_members(data: bytes) -> list[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 1500:
                raise ProviderError("Subtitle archive has too many entries")
            return [
                e.filename
                for e in entries
                if not e.is_dir()
                and not e.flag_bits & 1
                and PurePosixPath(e.filename).suffix.lower() in TEXT_SUFFIXES
                and 0 < e.file_size <= 4 * 1024 * 1024
                and e.file_size <= max(1, e.compress_size) * 300
            ]
    except (zipfile.BadZipFile, OSError):
        raise ProviderError("Provider returned an invalid ZIP archive") from None


class Kitsunekko:
    def __init__(self, client: HttpClient):
        self.client = client

    def search(self, episode: Episode, language: str, filename: str = "") -> list[Candidate]:
        language_dir = "japanese" if language == "jpn" else "english"
        root = f"subtitles/{language_dir}/"
        index = self.client.get(
            KITSUNEKKO + "dirlist.php?" + urlencode({"dir": root}), ttl=21600, limit=3 * 1024 * 1024
        ).decode("utf-8")
        base_titles = {normalized(t) for t in episode.titles}
        seasonal = set()
        if episode.season > 1:
            for title in episode.titles:
                seasonal.update(
                    normalized(f"{title} {suffix}")
                    for suffix in (
                        f"S{episode.season}",
                        f"Season {episode.season}",
                        f"{episode.season}",
                        f"{episode.season}nd Season",
                        f"{episode.season}rd Season",
                        f"{episode.season}th Season",
                    )
                )
        folders = []
        for href, _ in Links(index).links:
            path = parse_qs(urlsplit(href).query).get("dir", [""])[0]
            if not path.startswith(root) or path == root:
                continue
            title = normalized(path.removeprefix(root).strip("/"))
            if title in base_titles | seasonal:
                folders.append((path, title in seasonal))
        candidates = []
        archive_failed = False
        for path, seasonal_folder in dict.fromkeys(folders):
            url = KITSUNEKKO + "dirlist.php?" + urlencode({"dir": path})
            listing = self.client.get(url, ttl=3600, limit=2 * 1024 * 1024).decode("utf-8")
            files = []
            for href, _ in Links(listing).links:
                asset = urljoin(KITSUNEKKO, href)
                name = unquote(urlsplit(asset).path)
                if urlsplit(asset).hostname != "kitsunekko.net" or not name.startswith("/" + path):
                    continue
                if PurePosixPath(name).suffix.lower() in TEXT_SUFFIXES | {".zip"}:
                    files.append((asset, name))
            files.sort(
                key=lambda row: (
                    -release_score(row[1], filename),
                    ".zip" == PurePosixPath(row[1]).suffix.lower(),
                    row[1],
                )
            )
            archives = 0
            for asset, name in files:
                if re.search(r"(?i)(?:[._ -](?:en|eng|english)[._ -])", name) and language == "jpn":
                    continue
                if PurePosixPath(name).suffix.lower() == ".zip":
                    if archives >= 2:
                        continue
                    archives += 1
                    try:
                        members = archive_members(
                            self.client.get(quote(asset, safe=":/%?=&+"), ttl=86400)
                        )
                    except ProviderError:
                        archive_failed = True
                        continue
                    for member in members:
                        if episode_matches(member, episode, seasonal_folder=seasonal_folder):
                            candidates.append(
                                Candidate(
                                    "Kitsunekko",
                                    language,
                                    quote(asset, safe=":/%?=&+"),
                                    PurePosixPath(name).name + ": " + member,
                                    member,
                                )
                            )
                elif episode_matches(name, episode, seasonal_folder=seasonal_folder):
                    candidates.append(
                        Candidate(
                            "Kitsunekko",
                            language,
                            quote(asset, safe=":/%?=&+"),
                            PurePosixPath(name).name,
                        )
                    )
            if len(candidates) >= 8:
                break
        if not candidates and archive_failed:
            raise ProviderError("Subtitle archives could not be downloaded or inspected")
        return sorted(candidates, key=lambda c: -release_score(c.filename, filename))[:8]


class OpenSubtitles:
    def __init__(self, client: HttpClient):
        self.client = client

    def search(
        self, episode: Episode, extra: dict[str, str], language: str = "eng"
    ) -> list[Candidate]:
        extra = {k: v for k, v in extra.items() if k in {"filename", "videoHash", "videoSize"}}
        path = f"/subtitles/{episode.media_type}/{quote(episode.video_id, safe=':')}"
        if extra:
            path += "/" + urlencode(extra, quote_via=quote)
        result = self.client.json(OPEN_SUBTITLES + path + ".json", ttl=1800)
        candidates = []
        aliases = {language} | ({"en"} if language == "eng" else set())
        seen = set()
        for row in result.get("subtitles", [])[:200]:
            if not isinstance(row, dict) or row.get("lang") not in aliases:
                continue
            url = row.get("url")
            if not isinstance(url, str):
                continue
            try:
                validate_url(url)
            except (ValueError, ProviderError):
                continue
            if url in seen:
                continue
            seen.add(url)
            name = "English" if language == "eng" else language
            label = row.get("label") or f"{name} track {row.get('id', len(candidates) + 1)}"
            candidates.append(Candidate("OpenSubtitles", language, url, str(label)[:240]))
        return candidates[:32]
