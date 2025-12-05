# C/C++ Runner Image
# Supports C and C++ compilation and execution

FROM gcc:13-bookworm

LABEL maintainer="Code Execution Engine"
LABEL description="C/C++ runner"

# Install utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r runner && useradd -r -g runner runner

# Create workspace
RUN mkdir -p /workspace && chown runner:runner /workspace

# Copy runner script
COPY runner.sh /usr/local/bin/runner.sh
RUN chmod +x /usr/local/bin/runner.sh

WORKDIR /workspace

USER runner

CMD ["/bin/sh"]

