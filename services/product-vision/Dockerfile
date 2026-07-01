FROM python:3.11-slim

WORKDIR /app

# Install Intel RealSense SDK system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    libgl1 \
    libglib2.0-0 \
    udev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service source
COPY src/ ./src/

# The model file and .env must be mounted at runtime:
#   docker run -v ./models:/app/models -v ./.env:/app/.env product-vision
# (model weights are gitignored and not baked into the image)

ENV PYTHONPATH=/app/src

CMD ["python", "src/main.py"]
