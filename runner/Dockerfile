# Code Runner Docker Image
# Multi-language support for code execution

FROM ubuntu:22.04

LABEL maintainer="Code Execution Engine"
LABEL description="Sandboxed code execution environment"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Core utilities
    curl \
    wget \
    ca-certificates \
    gnupg \
    # Build essentials (for compiled languages)
    build-essential \
    # Languages
    python3 \
    python3-pip \
    openjdk-17-jdk \
    golang-go \
    ruby \
    php \
    # Rust (via rustup)
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    # Node.js 20.x
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Install TypeScript globally
RUN npm install -g typescript ts-node

# Install Python packages (if needed)
RUN pip3 install --no-cache-dir numpy

# Create non-root user for running code
RUN groupadd -r runner && useradd -r -g runner -d /home/runner -m runner

# Create directories
RUN mkdir -p /runner /workspace && \
    chown -R runner:runner /runner /workspace

# Copy runner script
COPY runner.js /runner/runner.js

# Set permissions
RUN chmod +x /runner/runner.js && \
    chown runner:runner /runner/runner.js

# Switch to non-root user
USER runner

# Set working directory
WORKDIR /workspace

# Default command
CMD ["node", "/runner/runner.js"]

