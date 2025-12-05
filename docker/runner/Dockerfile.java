# Java Runner Image
# Supports Java 21 compilation and execution

FROM eclipse-temurin:21-jdk-alpine

LABEL maintainer="Code Execution Engine"
LABEL description="Java runner"

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

CMD ["/bin/sh"]

