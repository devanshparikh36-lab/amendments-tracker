FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/pipeline/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY packages/db /app/packages/db
COPY services/pipeline /app/services/pipeline
WORKDIR /app/services/pipeline
ENV PYTHONUNBUFFERED=1
CMD ["python", "cli.py", "run"]
