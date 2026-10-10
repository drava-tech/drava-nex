import socket
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent import single_instance  # noqa: E402


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class SingleInstanceTests(unittest.TestCase):
    def tearDown(self):
        if single_instance._held is not None:
            single_instance._held.close()
            single_instance._held = None

    def test_second_copy_is_refused_until_the_first_ends(self):
        port = _free_port()
        self.assertTrue(single_instance.acquire(port))
        first = single_instance._held
        self.assertFalse(single_instance.acquire(port))
        self.assertIs(single_instance._held, first)  # a refused copy doesn't replace the holder
        first.close()
        single_instance._held = None
        self.assertTrue(single_instance.acquire(port))  # the port frees when the holder goes

    def test_exit_code_is_distinct_from_a_crash(self):
        self.assertNotIn(single_instance.EXIT_ALREADY_RUNNING, (0, 1))


if __name__ == "__main__":
    unittest.main()
