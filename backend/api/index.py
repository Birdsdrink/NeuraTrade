"""Vercel serverless entry point.

Wraps the FastAPI application so it can run on Vercel's Python Functions.
"""
import os
from pathlib import Path

# Make sure .env is picked up from the backend directory if present (local only)
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from mangum import Mangum  # noqa: E402
from app.main import app  # noqa: E402

handler = Mangum(app)
