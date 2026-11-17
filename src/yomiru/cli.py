"""Convert caption pairs and serve a local Stremio subtitle library."""

import argparse
import sys
from pathlib import Path

from yomiru.discovery import Discovery
from yomiru.japanese import Script
from yomiru.library import Library
from yomiru.render import Appearance
from yomiru.server import make_server
from yomiru.service import manage
from yomiru.timing import Timing


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
    serve.add_argument("--all-scripts", action="store_true", help="Offer all four display modes")
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
    publish = commands.add_parser("publish", help="Prepare an administrator-published episode")
    publish.add_argument("--pairs", type=Path, required=True)
    publish.add_argument("--video-id", action="append", required=True)
    publish.add_argument("--source-label", required=True)
    publish.add_argument("--source-url", required=True)
    publish.add_argument("--type", choices=["movie", "series"], default="series")
    publish.add_argument("--language", default="eng")
    publish.add_argument("--data-dir", type=Path, default=Path(".local/published"))
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
        if args.command == "publish":
            import json

            from yomiru.publication import publish

            print(json.dumps(publish(
                args.pairs, args.data_dir, args.video_id, args.source_label, args.source_url,
                media_type=args.type, language=args.language,
            )))
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
