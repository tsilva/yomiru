"""Convert caption pairs and serve a local Stremio subtitle library."""

import argparse
import sys
from pathlib import Path

from yomiru.discovery import Discovery
from yomiru.japanese import Script
from yomiru.library import Library
from yomiru.render import Appearance
from yomiru.server import make_server
from yomiru.service import manage, manage_review
from yomiru.timing import Timing
from yomiru.translation_harness import add_arguments as add_translation_arguments


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="yomiru")
    commands = root.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="Build a styled track from Japanese/English captions")
    build.add_argument("--japanese", type=Path, required=True)
    build.add_argument("--english", type=Path, required=True)
    build.add_argument("--video-id", required=True)
    build.add_argument("--type", choices=["movie", "series"], default="series")
    build.add_argument("--script", type=Script, choices=list(Script), default=Script.ROMAJI)
    build.add_argument("--release", default="", help="Required substring in the stream filename")
    build.add_argument("--width", type=int, default=1440)
    build.add_argument("--height", type=int, default=1080)
    build.add_argument("--japanese-colour", default="#FFEAB5")
    build.add_argument("--english-colour", default="#A8E6FF")
    build.add_argument("--data-dir", type=Path, default=Path(".local/library"))
    serve = commands.add_parser("serve", help="Serve the generated library to Stremio")
    serve.add_argument("--data-dir", type=Path, default=Path(".local/library"))
    serve.add_argument(
        "--port", default="auto", help="auto, or a fixed port to keep an install URL"
    )
    serve.add_argument(
        "--script",
        type=Script,
        choices=list(Script),
        default=Script.ROMAJI,
        help="Japanese display for automatically discovered tracks",
    )
    serve.add_argument(
        "--all-scripts", action="store_true", help="Offer rōmaji, kana and original Japanese"
    )
    serve.add_argument(
        "--no-discovery", action="store_true", help="Serve only manually built tracks"
    )
    discover = commands.add_parser("discover", help="Find and build an episode's subtitles")
    discover.add_argument("--video-id", required=True)
    discover.add_argument("--type", choices=["movie", "series"], default="series")
    discover.add_argument("--filename", default="")
    discover.add_argument("--script", type=Script, choices=list(Script), default=Script.ROMAJI)
    discover.add_argument("--data-dir", type=Path, default=Path(".local/library"))
    for command in (serve, discover):
        command.add_argument(
            "--base-language",
            default="eng",
            help="Three-letter subtitle language, such as eng, por or spa",
        )
        command.add_argument("--width", type=int, default=1440)
        command.add_argument("--height", type=int, default=1080)
        command.add_argument("--japanese-colour", default="#FFEAB5")
        command.add_argument("--english-colour", default="#A8E6FF")
    service = commands.add_parser("service", help="Manage the local macOS background service")
    service.add_argument("action", choices=["install", "status", "uninstall"])
    service.add_argument("--port", type=int, default=8808)
    review = commands.add_parser("review-service", help="Manage the macOS vocabulary review worker")
    review.add_argument("action", choices=["install", "status", "uninstall"])
    review.add_argument("--node", type=Path)
    review.add_argument("--executor", type=Path)
    review.add_argument("--deployment")
    translate = commands.add_parser("translate", help="Generate subtitles from Japanese captions")
    add_translation_arguments(translate)
    publish = commands.add_parser("publish", help="Prepare an administrator-published episode")
    publish.add_argument("--pairs", type=Path, help="Translation pairs or existing cue anchors")
    publish.add_argument("--romaji-only", action="store_true", help="Publish one romaji track")
    publish.add_argument(
        "--script", type=Script, choices=list(Script), help="Publish only this reading mode",
    )
    publish.add_argument("--video-id", action="append", required=True)
    publish.add_argument("--source-label", required=True)
    publish.add_argument("--source-url", required=True)
    publish.add_argument("--type", choices=["movie", "series"], default="series")
    publish.add_argument("--language", help="Language code (eng by default, jpn for --romaji-only)")
    publish.add_argument("--data-dir", type=Path, default=Path(".local/published"))
    publish.add_argument("--dictionary", type=Path, help="JMdict English XML or gzip file")
    publish.add_argument("--japanese-source", type=Path, help="Original Japanese subtitle file")
    publish.add_argument("--archive-dir", type=Path, help="Private source archive directory")
    publish.add_argument(
        "--exclude-spans", type=Path, help="Reviewed cue IDs and exact token spans",
    )
    archive = commands.add_parser("archive-source", help="Archive an existing Japanese subtitle")
    archive.add_argument("--pairs", type=Path, required=True)
    archive.add_argument("--japanese-source", type=Path, required=True)
    archive.add_argument("--archive-dir", type=Path, required=True)
    study = commands.add_parser(
        "study-vocabulary", help="Stage a vocabulary-only cleanup for an archived source",
    )
    study.add_argument("--pairs", type=Path, required=True)
    study.add_argument("--japanese-source", type=Path, required=True)
    study.add_argument("--data-dir", type=Path, required=True)
    study.add_argument("--video-id", action="append", required=True)
    study.add_argument("--exclude-spans", type=Path, help="Reviewed cue IDs and exact token spans")
    vocabulary = commands.add_parser(
        "vocabulary", help="Add vocabulary to an exact published episode"
    )
    vocabulary.add_argument("--pairs", type=Path, required=True)
    vocabulary.add_argument("--video-id", action="append", required=True)
    vocabulary.add_argument("--dictionary", type=Path, required=True)
    vocabulary.add_argument("--data-dir", type=Path, default=Path(".local/published"))
    registry = commands.add_parser(
        "vocabulary-registry", help="Rebuild the shared master vocabulary"
    )
    registry.add_argument("--data-dir", type=Path, default=Path(".local/published"))
    registry.add_argument("--pairs-root", type=Path, required=True)
    registry.add_argument("--dictionary", type=Path, required=True)
    registry.add_argument("--names", type=Path, help="JMnedict simplified JSON archive")
    meanings = commands.add_parser("vocabulary-meanings", help="Correct shared vocabulary meanings")
    meanings.add_argument("--data-dir", type=Path, default=Path(".local/published"))
    meanings.add_argument("--corrections", type=Path, required=True)
    jmdict = commands.add_parser("jmdict-rows", help="Export JMdict rows for the shared dictionary")
    jmdict.add_argument("--dictionary", type=Path, required=True)
    for command in (build, serve, discover):
        command.add_argument(
            "--align-timing", action=argparse.BooleanOptionalAction,
            default=command is not build,
            help="Estimate a consistent Japanese offset against the base captions",
        )
        command.add_argument("--japanese-delay-ms", type=int, default=0)
        command.add_argument("--base-delay-ms", type=int, default=0)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "service":
            print(manage(args.action, Path.cwd(), args.port))
            return 0
        if args.command == "review-service":
            print(manage_review(args.action, Path.cwd(), args.node, args.executor, args.deployment))
            return 0
        if args.command == "translate":
            from yomiru.translation_harness import run

            return run(args)
        if args.command == "publish":
            import json

            from yomiru.publication import publish
            from yomiru.study_vocabulary import read_reviewed_spans

            print(json.dumps(publish(
                args.pairs, args.data_dir, args.video_id, args.source_label, args.source_url,
                media_type=args.type, language=args.language, dictionary=args.dictionary,
                japanese_source=args.japanese_source, archive_directory=args.archive_dir,
                romaji_only=args.romaji_only, reading_mode=args.script,
                excluded_spans=read_reviewed_spans(args.exclude_spans),
            )))
            return 0
        if args.command == "archive-source":
            import json

            from yomiru.publication import load_pairs
            from yomiru.source_archive import archive_source

            _, pairs = load_pairs(args.pairs)
            source, _ = archive_source(
                args.japanese_source, args.archive_dir, pairs["cues"], published_selection=True,
            )
            print(json.dumps({"source_archive": source, "cues": len(pairs["cues"])}))
            return 0
        if args.command == "study-vocabulary":
            import json

            from yomiru.publication import load_pairs
            from yomiru.registry import write_episode_vocabulary
            from yomiru.source_archive import archive_source
            from yomiru.study_vocabulary import read_reviewed_spans

            _, pairs = load_pairs(args.pairs)
            source, words = archive_source(
                args.japanese_source, args.data_dir / "private", pairs["cues"],
                published_selection=True, excluded_spans=read_reviewed_spans(args.exclude_spans),
            )
            descriptor = write_episode_vocabulary(
                args.data_dir, words, source["anchor"], args.video_id,
            )
            print(json.dumps({"manifest": source["manifest"], "vocabulary": descriptor}))
            return 0
        if args.command == "jmdict-rows":
            import json

            from yomiru.jmdict import seed_rows

            for row in seed_rows(args.dictionary):
                print(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            return 0
        if args.command == "vocabulary":
            import json

            from yomiru.vocabulary import prepare_vocabulary

            print(json.dumps(prepare_vocabulary(
                args.pairs, args.data_dir, args.video_id, args.dictionary,
            )))
            return 0
        if args.command == "vocabulary-registry":
            import json

            from yomiru.registry import rebuild_registry

            print(json.dumps(rebuild_registry(
                args.data_dir, args.pairs_root, args.dictionary, args.names,
            )))
            return 0
        if args.command == "vocabulary-meanings":
            import json

            from yomiru.registry import correct_meanings

            print(json.dumps(correct_meanings(args.data_dir, args.corrections)))
            return 0
        library = Library(args.data_dir)
        timing = Timing(args.align_timing, args.japanese_delay_ms, args.base_delay_ms)
        if args.command == "discover":
            discovery = Discovery(
                library,
                scripts=(args.script,),
                base_language=args.base_language,
                timing=timing,
                appearance=Appearance(
                    args.width, args.height, args.japanese_colour, args.english_colour
                ),
            )
            selections, status = discovery.search(
                args.video_id, args.type, {"filename": args.filename}
            )
            print(status["message"])
            for warning in status["warnings"]:
                print(warning, file=sys.stderr)
            if not selections:
                return 1
            for selection in selections:
                try:
                    discovery.generate(selection.key)
                except (ValueError, OSError):
                    continue
                track = discovery.generated[selection.key]
                print(f"Japanese: {selection.japanese.provider} — {selection.japanese.filename}")
                print(f"Base: {selection.base.provider} — {selection.base.filename}")
                print(library.directory / f"{track.key}.ass")
                return 0
            print("No discovered pair could be downloaded and rendered", file=sys.stderr)
            return 1
        if args.command == "build":
            appearance = Appearance(
                args.width, args.height, args.japanese_colour, args.english_colour
            )
            track = library.build(
                args.japanese,
                args.english,
                args.video_id,
                args.script,
                appearance,
                args.type,
                args.release,
                timing=timing,
            )
            print(library.directory / f"{track.key}.ass")
            if not track.release_hint:
                print(
                    "Release matching was not specified; verify timing with your video.",
                    file=sys.stderr,
                )
            return 0
        port = 0 if args.port == "auto" else int(args.port)
        if not 0 <= port <= 65535:
            raise ValueError("Port must be auto or between 0 and 65535")
        discovery = (
            None
            if args.no_discovery
            else Discovery(
                library,
                scripts=tuple(Script) if args.all_scripts else (args.script,),
                base_language=args.base_language,
                timing=timing,
                appearance=Appearance(
                    args.width, args.height, args.japanese_colour, args.english_colour
                ),
            )
        )
        server = make_server(library, port, discovery)
        print(f"Stremio manifest: http://127.0.0.1:{server.server_port}/manifest.json", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return 0
    except (OSError, ValueError) as error:
        print(f"yomiru: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
