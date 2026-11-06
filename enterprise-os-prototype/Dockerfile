FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 GEBRID_DEMO_MODE=1 GEBRID_DB_PATH=/app/data/gebrid.db GEBRID_KEY_PATH=/app/data/.local_integrity_key
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY gebrid ./gebrid
COPY frontend ./frontend
RUN mkdir -p /app/data && useradd --uid 10001 --create-home appuser && chown -R appuser:appuser /app/data
USER appuser
EXPOSE 8000
CMD ["uvicorn", "gebrid.app:app", "--host", "0.0.0.0", "--port", "8000"]
