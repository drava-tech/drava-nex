import uvicorn
from server.settings import settings

if __name__ == "__main__":
    uvicorn.run(
        "server.app:create_app",
        host="0.0.0.0",
        port=settings.port,
        factory=True,
        log_level="info",
        access_log=False
    )
