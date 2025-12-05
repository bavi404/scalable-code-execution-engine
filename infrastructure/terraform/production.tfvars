# =============================================================================
# Production Environment Configuration
# =============================================================================

aws_region  = "us-east-1"
environment = "production"
vpc_cidr    = "10.0.0.0/16"

# Container Pool Configuration
# For: JavaScript, Python, Ruby, PHP
# Lighter workloads, faster cold starts
container_pool_config = {
  min_capacity   = 5       # Always have 5 workers ready
  max_capacity   = 100     # Scale up to 100 during peak
  cpu            = 1024    # 1 vCPU per worker
  memory         = 2048    # 2 GB per worker
  max_concurrent = 8       # 8 concurrent jobs per worker
}

# MicroVM Pool Configuration
# For: C, C++, Java, Rust, Go
# Heavier workloads, stronger isolation
microvm_pool_config = {
  min_capacity   = 2       # Keep 2 warm for compiled languages
  max_capacity   = 50      # Scale up to 50
  cpu            = 2048    # 2 vCPU per worker
  memory         = 4096    # 4 GB per worker
  max_concurrent = 2       # 2 concurrent VMs per worker
}

# Redis Configuration
# r6g.large: 2 vCPU, 13.07 GB
redis_node_type = "cache.r6g.large"

# PostgreSQL Configuration
# db.r6g.large: 2 vCPU, 16 GB
db_instance_class = "db.r6g.large"

