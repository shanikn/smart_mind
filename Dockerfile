FROM python:3.11-slim

# the server runs as this unprivileged user, not root
RUN useradd --create-home --uid 1000 app

WORKDIR /app

# the embedding model is cached here, readable by the app user (not under
# /home, which Azure can mount persistent storage over)
ENV HF_HOME=/opt/huggingface
RUN mkdir -p /opt/huggingface && chown app:app /opt/huggingface

COPY requirements.txt .
RUN pip install torch==2.14.1+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install -r requirements.txt

# Pre-download the model before copying code — cached as its own layer,
# so code-only changes don't re-download the model on rebuild
USER app
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

USER root
COPY --chown=app:app . .
# ChromaDB writes here
RUN mkdir -p /app/chroma_db && chown app:app /app/chroma_db

USER app

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
