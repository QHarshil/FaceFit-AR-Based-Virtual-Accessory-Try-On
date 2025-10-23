#!/bin/bash

echo "🚀 Starting FaceFit AR..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose down 2>/dev/null || docker compose down 2>/dev/null

echo ""
echo "🔨 Building and starting containers..."
echo ""

# Build and start containers
if docker-compose up --build -d; then
    echo ""
    echo "✅ FaceFit AR is now running!"
    echo ""
    echo "📱 Access the application at: http://localhost:3000"
    echo "🔧 Backend API running at: http://localhost:5000"
    echo ""
    echo "📋 View logs with: docker-compose logs -f"
    echo "🛑 Stop with: docker-compose down"
    echo ""
elif docker compose up --build -d; then
    echo ""
    echo "✅ FaceFit AR is now running!"
    echo ""
    echo "📱 Access the application at: http://localhost:3000"
    echo "🔧 Backend API running at: http://localhost:5000"
    echo ""
    echo "📋 View logs with: docker compose logs -f"
    echo "🛑 Stop with: docker compose down"
    echo ""
else
    echo ""
    echo "❌ Failed to start containers"
    exit 1
fi

