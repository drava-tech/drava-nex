"""Entry for `python -m vision.workers.people` (spawned by the supervisor)."""

import logging

from ..pipeline import main

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    main()
