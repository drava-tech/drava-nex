"""Entry point: `python -m vision` (run from services/) → supervisor."""

import logging

from .supervisor import run

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    run()
