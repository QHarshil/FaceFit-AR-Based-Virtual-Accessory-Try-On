#!/bin/bash
set -e

if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Install Docker first."
    exit 1
fi

if docker compose version &> /dev/null; then
    compose=(docker compose)
elif command -v docker-compose &> /dev/null; then
    compose=(docker-compose)
else
    echo "Docker Compose is not installed. Install Docker Compose first."
    exit 1
fi

"${compose[@]}" down 2>/dev/null || true

if "${compose[@]}" up --build -d; then
    echo ""
    echo "FaceFit AR is running."
    echo "App: http://localhost:3000"
    echo "API: http://localhost:5055"
    echo ""
    echo "Logs: ${compose[*]} logs -f"
    echo "Stop: ${compose[*]} down"
else
    echo "Failed to start containers."
    exit 1
fi
