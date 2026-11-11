# Personal Site API

A simple FastAPI service for the personal site.

## Setup

1. Install dependencies with uv:
   ```bash
   uv sync
   ```

2. Run the server:
   ```bash
   uv run python main.py
   ```

   Or with uvicorn directly:
   ```bash
   uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

## Development

For development with additional dev dependencies:
```bash
uv sync --dev
```

## Railway Deployment

This API is configured to deploy on Railway:

1. Connect your GitHub repository to Railway
2. Railway will automatically detect the Python project and use uv for dependency management
3. The service will be available at the Railway-provided URL

### Railway Configuration

- **railway.toml**: Contains Railway-specific configuration including health checks
- **Procfile**: Defines the web process command
- **pyproject.toml**: Contains project scripts and dependencies

The API will automatically start with:
```bash
uv run uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Endpoints

- `GET /` - Root endpoint
- `GET /health` - Health check
- `GET /api/hello` - Simple hello endpoint

## Development

The API runs on `http://localhost:8000` by default.

Interactive API documentation is available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Database and Migrations

This project uses PostgreSQL and Alembic for database migrations.

1.  **Environment Setup**:
    Create a `.env` file in the `api` directory based on `.env.example`:
    ```bash
    cp .env.example .env
    ```
    Update `DATABASE_URL` in `.env` with your PostgreSQL credentials.
    Set `ADMIN_TOKEN` to a long random string. The `/api/admin/*` endpoints (and the
    `/admin` dashboard) require it as `Authorization: Bearer <token>`, and stay closed if it's unset.

    Visitor locations come from the free [DB-IP City Lite](https://db-ip.com/db/download/ip-to-city-lite)
    database (CC BY 4.0), downloaded to `GEO_DIR` (default `/tmp/geo`) on startup.

2.  **Run Migrations**:
    Apply migrations to set up the database schema:
    ```bash
    uv run alembic upgrade head
    ```

3.  **create new migration**:
    To create a new migration after modifying `models.py`:
    ```bash
    uv run alembic revision --autogenerate -m "description of changes"
    ```
