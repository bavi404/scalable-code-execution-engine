# Go Runner Image
# Supports Go compilation and execution

FROM golang:1.22-alpine

LABEL maintainer="Code Execution Engine"
LABEL description="Go runner"

# Install utilities
RUN apk add --no-cache \
    bash \
    coreutils \
    procps \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -S runner && adduser -S runner -G runner

# Create workspace
RUN mkdir -p /workspace && chown runner:runner /workspace

# Copy runner script
COPY runner.sh /usr/local/bin/runner.sh
RUN chmod +x /usr/local/bin/runner.sh

WORKDIR /workspace

USER runner

# Disable Go modules for simple scripts
ENV GO111MODULE=off

CMD ["/bin/sh"]

