# Code Runner Docker Image
# Multi-language support with resource limits and network isolation

FROM ubuntu:22.04

LABEL maintainer="Code Execution Engine"
LABEL description="Sandboxed code execution environment with resource limits"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Core utilities
    curl \
    wget \
    ca-certificates \
    gnupg \
    time \
    # Build essentials (for compiled languages)
    build-essential \
    # Resource management
    cgroup-tools \
    util-linux \
    # Languages
    python3 \
    python3-pip \
    openjdk-17-jdk \
    golang-go \
    ruby \
    php \
    # Security
    iptables \
    # Rust (via rustup)
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    # Node.js 20.x
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Remove network tools for security
    && rm -f /usr/bin/wget /usr/bin/curl /usr/bin/nc /usr/bin/netcat 2>/dev/null || true

# Add Rust to PATH
ENV PATH="/root/.cargo/bin:${PATH}"

# Install TypeScript globally
RUN npm install -g typescript ts-node

# Install Python packages (if needed)
RUN pip3 install --no-cache-dir numpy

# Create non-root user for running code
RUN groupadd -r runner && useradd -r -g runner -d /home/runner -m -s /bin/bash runner

# Create directories
RUN mkdir -p /runner /workspace /output && \
    chown -R runner:runner /runner /workspace /output

# Copy all runner scripts
COPY harness.sh /runner/harness.sh
COPY runner.js /runner/runner.js
COPY run_tests.py /runner/run_tests.py
COPY network_isolation.sh /runner/network_isolation.sh

# Set permissions
RUN chmod +x /runner/*.sh /runner/*.py /runner/*.js && \
    chown -R runner:runner /runner

# Create seccomp profile directory
RUN mkdir -p /etc/seccomp

# Environment variables
ENV WORKSPACE_DIR=/workspace
ENV OUTPUT_DIR=/output
ENV USE_CGROUPS=false
ENV USE_SECCOMP=true

# Switch to non-root user (for security)
USER runner

# Set working directory
WORKDIR /workspace

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
    CMD echo "healthy" || exit 1

# Default command - run harness with environment variables
# Override with: docker run ... code-runner /runner/harness.sh javascript solution.js 5 256
CMD ["/runner/harness.sh"]

