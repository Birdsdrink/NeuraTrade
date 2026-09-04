FROM python:3.11-slim

WORKDIR /app

COPY ./backend /app

RUN pip install --no-cache-dir fastapi uvicorn[standard] pydantic sqlalchemy psycopg2-binary pandas numpy

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
