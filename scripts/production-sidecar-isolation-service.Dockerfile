FROM python:3.13-slim
WORKDIR /sidecar
COPY scripts/production_sidecar.py scripts/production-sidecar-isolation-service.py ./
CMD ["python", "production-sidecar-isolation-service.py"]
