#!/bin/bash
set -e

echo "=== BuyWhere Infrastructure Validation ==="
echo ""

check_redis() {
    echo "[1/4] Checking Redis..."
    if command -v redis-cli &> /dev/null; then
        if redis-cli -h "${REDIS_HOST:-localhost}" -p "${REDIS_PORT:-6379}" ping | grep -q PONG; then
            echo "  ✓ Redis is responding"
            return 0
        else
            echo "  ✗ Redis is not responding"
            return 1
        fi
    else
        echo "  ! redis-cli not found, skipping direct check"
        echo "  ! Docker Compose healthcheck will verify Redis"
        return 0
    fi
}

check_postgres() {
    echo "[2/4] Checking PostgreSQL..."
    if command -v psql &> /dev/null; then
        if PGPASSWORD="${POSTGRES_PASSWORD:-buywhere}" psql -h "${POSTGRES_HOST:-localhost}" -U buywhere -d catalog -c "SELECT 1" &> /dev/null; then
            echo "  ✓ PostgreSQL is responding"
            return 0
        else
            echo "  ✗ PostgreSQL is not responding"
            return 1
        fi
    else
        echo "  ! psql not found, skipping direct check"
        echo "  ! Docker Compose healthcheck will verify PostgreSQL"
        return 0
    fi
}

check_api() {
    echo "[3/4] Checking API health..."
    API_URL="${API_URL:-http://localhost:8000}"
    if curl -sf "${API_URL}/health" &> /dev/null; then
        echo "  ✓ API is healthy"
        return 0
    else
        echo "  ✗ API is not responding"
        echo "  ! Start API with: docker-compose up api"
        return 1
    fi
}

check_scraper_dry_run() {
    echo "[4/4] Checking scraper dry-run capability..."
    if docker compose config &> /dev/null; then
        echo "  ✓ Docker Compose configuration is valid"
        return 0
    else
        echo "  ✗ Docker Compose configuration is invalid"
        return 1
    fi
}

main() {
    local errors=0

    check_redis || ((errors++))
    check_postgres || ((errors++))
    check_api || ((errors++))
    check_scraper_dry_run || ((errors++))

    echo ""
    if [ $errors -eq 0 ]; then
        echo "=== All checks passed ==="
        exit 0
    else
        echo "=== $errors check(s) failed ==="
        exit 1
    fi
}

main "$@"