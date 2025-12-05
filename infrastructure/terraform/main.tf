# =============================================================================
# Code Execution Engine - Terraform Configuration
# =============================================================================
# 
# This configuration deploys:
# - ECS Cluster with Fargate
# - Container and MicroVM worker pools
# - Auto-scaling based on queue depth
# - ElastiCache Redis
# - RDS PostgreSQL
# - S3 bucket for code storage
#
# Usage:
#   terraform init
#   terraform plan -var-file="production.tfvars"
#   terraform apply -var-file="production.tfvars"
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket         = "code-execution-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "code-execution-engine"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "container_pool_config" {
  description = "Container pool configuration"
  type = object({
    min_capacity     = number
    max_capacity     = number
    cpu              = number
    memory           = number
    max_concurrent   = number
  })
  default = {
    min_capacity     = 2
    max_capacity     = 100
    cpu              = 1024   # 1 vCPU
    memory           = 2048   # 2 GB
    max_concurrent   = 8
  }
}

variable "microvm_pool_config" {
  description = "MicroVM pool configuration"
  type = object({
    min_capacity     = number
    max_capacity     = number
    cpu              = number
    memory           = number
    max_concurrent   = number
  })
  default = {
    min_capacity     = 1
    max_capacity     = 50
    cpu              = 2048   # 2 vCPU
    memory           = 4096   # 4 GB
    max_concurrent   = 2
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.large"
}

# =============================================================================
# Data Sources
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# =============================================================================
# VPC and Networking
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "code-execution-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = {
    Name = "code-execution-igw"
  }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  map_public_ip_on_launch = true
  
  tags = {
    Name = "code-execution-public-${count.index + 1}"
    Type = "public"
  }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name = "code-execution-private-${count.index + 1}"
    Type = "private"
  }
}

resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"
  
  tags = {
    Name = "code-execution-nat-${count.index + 1}"
  }
}

resource "aws_nat_gateway" "main" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  
  tags = {
    Name = "code-execution-nat-${count.index + 1}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  
  tags = {
    Name = "code-execution-public-rt"
  }
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }
  
  tags = {
    Name = "code-execution-private-rt-${count.index + 1}"
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "worker" {
  name_prefix = "code-execution-worker-"
  vpc_id      = aws_vpc.main.id
  description = "Security group for code execution workers"
  
  # Outbound to Redis
  egress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
  }
  
  # Outbound to RDS
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.database.id]
  }
  
  # Outbound to S3 (via VPC endpoint)
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [aws_vpc_endpoint.s3.prefix_list_id]
  }
  
  # Outbound to ECR (for pulling images)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "code-execution-worker-sg"
  }
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "redis" {
  name_prefix = "code-execution-redis-"
  vpc_id      = aws_vpc.main.id
  description = "Security group for ElastiCache Redis"
  
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }
  
  tags = {
    Name = "code-execution-redis-sg"
  }
}

resource "aws_security_group" "database" {
  name_prefix = "code-execution-db-"
  vpc_id      = aws_vpc.main.id
  description = "Security group for RDS PostgreSQL"
  
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }
  
  tags = {
    Name = "code-execution-db-sg"
  }
}

# =============================================================================
# VPC Endpoints (for private connectivity)
# =============================================================================

resource "aws_vpc_endpoint" "s3" {
  vpc_id       = aws_vpc.main.id
  service_name = "com.amazonaws.${var.aws_region}.s3"
  
  route_table_ids = concat(
    [aws_route_table.public.id],
    aws_route_table.private[*].id
  )
  
  tags = {
    Name = "code-execution-s3-endpoint"
  }
}

resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.worker.id]
  private_dns_enabled = true
  
  tags = {
    Name = "code-execution-ecr-api-endpoint"
  }
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.worker.id]
  private_dns_enabled = true
  
  tags = {
    Name = "code-execution-ecr-dkr-endpoint"
  }
}

# =============================================================================
# S3 Bucket
# =============================================================================

resource "aws_s3_bucket" "code_storage" {
  bucket_prefix = "code-execution-storage-"
  
  tags = {
    Name = "code-execution-storage"
  }
}

resource "aws_s3_bucket_versioning" "code_storage" {
  bucket = aws_s3_bucket.code_storage.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "code_storage" {
  bucket = aws_s3_bucket.code_storage.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "code_storage" {
  bucket = aws_s3_bucket.code_storage.id
  
  rule {
    id     = "cleanup-old-submissions"
    status = "Enabled"
    
    filter {
      prefix = "submissions/"
    }
    
    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_public_access_block" "code_storage" {
  bucket = aws_s3_bucket.code_storage.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# =============================================================================
# ElastiCache Redis
# =============================================================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "code-execution-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "code-execution-redis"
  description                = "Redis cluster for code execution job queue"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  port                       = 6379
  parameter_group_name       = "default.redis7"
  engine_version             = "7.0"
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  tags = {
    Name = "code-execution-redis"
  }
}

# =============================================================================
# RDS PostgreSQL
# =============================================================================

resource "aws_db_subnet_group" "main" {
  name       = "code-execution-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier           = "code-execution-db"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = var.db_instance_class
  allocated_storage    = 100
  max_allocated_storage = 500
  storage_type         = "gp3"
  storage_encrypted    = true
  
  db_name  = "code_execution"
  username = "postgres"
  password = random_password.db_password.result
  
  vpc_security_group_ids = [aws_security_group.database.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name
  
  multi_az               = true
  publicly_accessible    = false
  deletion_protection    = true
  skip_final_snapshot    = false
  final_snapshot_identifier = "code-execution-final-snapshot"
  
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"
  
  performance_insights_enabled = true
  
  tags = {
    Name = "code-execution-db"
  }
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_password" {
  name_prefix = "code-execution-db-password-"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db_password.result
    host     = aws_db_instance.main.endpoint
    port     = 5432
    database = aws_db_instance.main.db_name
  })
}

# =============================================================================
# ECR Repositories
# =============================================================================

resource "aws_ecr_repository" "worker" {
  name                 = "code-execution-worker"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "runner" {
  name                 = "code-runner"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name
  
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# =============================================================================
# ECS Cluster
# =============================================================================

resource "aws_ecs_cluster" "main" {
  name = "code-execution-cluster"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  
  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.ecs.name
      }
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 80
    base              = 2
  }
  
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 20
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/code-execution"
  retention_in_days = 30
}

# =============================================================================
# IAM Roles
# =============================================================================

resource "aws_iam_role" "ecs_task_execution" {
  name_prefix = "code-execution-task-exec-"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_task_execution.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.db_password.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name_prefix = "code-execution-task-"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "s3-access"
  role = aws_iam_role.ecs_task.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${aws_s3_bucket.code_storage.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.code_storage.arn
        ]
      }
    ]
  })
}

# =============================================================================
# ECS Task Definition - Container Pool Workers
# =============================================================================

resource "aws_ecs_task_definition" "container_worker" {
  family                   = "container-pool-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.container_pool_config.cpu
  memory                   = var.container_pool_config.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.worker.repository_url}:latest"
      
      essential = true
      
      environment = [
        {
          name  = "WORKER_POOL"
          value = "container"
        },
        {
          name  = "MAX_CONCURRENT_JOBS"
          value = tostring(var.container_pool_config.max_concurrent)
        },
        {
          name  = "RUNNER_IMAGE"
          value = "${aws_ecr_repository.runner.repository_url}:latest"
        },
        {
          name  = "S3_BUCKET_NAME"
          value = aws_s3_bucket.code_storage.id
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "REDIS_URL"
          value = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
        }
      ]
      
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.db_password.arn
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "container-worker"
        }
      }
      
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# =============================================================================
# ECS Task Definition - MicroVM Pool Workers
# =============================================================================

resource "aws_ecs_task_definition" "microvm_worker" {
  family                   = "microvm-pool-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.microvm_pool_config.cpu
  memory                   = var.microvm_pool_config.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([
    {
      name  = "worker"
      image = "${aws_ecr_repository.worker.repository_url}:latest"
      
      essential = true
      
      environment = [
        {
          name  = "WORKER_POOL"
          value = "microvm"
        },
        {
          name  = "MAX_CONCURRENT_JOBS"
          value = tostring(var.microvm_pool_config.max_concurrent)
        },
        {
          name  = "S3_BUCKET_NAME"
          value = aws_s3_bucket.code_storage.id
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "REDIS_URL"
          value = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
        }
      ]
      
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.db_password.arn
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "microvm-worker"
        }
      }
      
      linuxParameters = {
        capabilities = {
          add = ["SYS_ADMIN"]  # Required for Firecracker
        }
      }
    }
  ])
}

# =============================================================================
# ECS Services
# =============================================================================

resource "aws_ecs_service" "container_pool" {
  name            = "container-pool-workers"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.container_worker.arn
  desired_count   = var.container_pool_config.min_capacity
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }
  
  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }
  
  lifecycle {
    ignore_changes = [desired_count]  # Managed by autoscaling
  }
}

resource "aws_ecs_service" "microvm_pool" {
  name            = "microvm-pool-workers"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.microvm_worker.arn
  desired_count   = var.microvm_pool_config.min_capacity
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }
  
  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }
  
  lifecycle {
    ignore_changes = [desired_count]  # Managed by autoscaling
  }
}

# =============================================================================
# Auto Scaling - Container Pool
# =============================================================================

resource "aws_appautoscaling_target" "container_pool" {
  max_capacity       = var.container_pool_config.max_capacity
  min_capacity       = var.container_pool_config.min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.container_pool.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "container_pool_queue_depth" {
  name               = "container-pool-queue-depth-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.container_pool.resource_id
  scalable_dimension = aws_appautoscaling_target.container_pool.scalable_dimension
  service_namespace  = aws_appautoscaling_target.container_pool.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value       = 10  # Target 10 jobs per worker
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    
    customized_metric_specification {
      metric_name = "QueueDepthPerWorker"
      namespace   = "CodeExecution"
      statistic   = "Average"
      
      dimensions {
        name  = "Pool"
        value = "container"
      }
    }
  }
}

resource "aws_appautoscaling_policy" "container_pool_cpu" {
  name               = "container-pool-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.container_pool.resource_id
  scalable_dimension = aws_appautoscaling_target.container_pool.scalable_dimension
  service_namespace  = aws_appautoscaling_target.container_pool.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value       = 70  # Target 70% CPU utilization
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# =============================================================================
# Auto Scaling - MicroVM Pool
# =============================================================================

resource "aws_appautoscaling_target" "microvm_pool" {
  max_capacity       = var.microvm_pool_config.max_capacity
  min_capacity       = var.microvm_pool_config.min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.microvm_pool.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "microvm_pool_queue_depth" {
  name               = "microvm-pool-queue-depth-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.microvm_pool.resource_id
  scalable_dimension = aws_appautoscaling_target.microvm_pool.scalable_dimension
  service_namespace  = aws_appautoscaling_target.microvm_pool.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value       = 5  # Target 5 jobs per worker (lower due to heavier jobs)
    scale_in_cooldown  = 600
    scale_out_cooldown = 60
    
    customized_metric_specification {
      metric_name = "QueueDepthPerWorker"
      namespace   = "CodeExecution"
      statistic   = "Average"
      
      dimensions {
        name  = "Pool"
        value = "microvm"
      }
    }
  }
}

# =============================================================================
# CloudWatch Alarms
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "high_queue_depth" {
  alarm_name          = "code-execution-high-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "QueueDepth"
  namespace           = "CodeExecution"
  period              = 60
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "Queue depth is too high"
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "high_error_rate" {
  alarm_name          = "code-execution-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "ErrorRate"
  namespace           = "CodeExecution"
  period              = 300
  statistic           = "Average"
  threshold           = 5
  alarm_description   = "Error rate is above 5%"
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_sns_topic" "alerts" {
  name = "code-execution-alerts"
}

# =============================================================================
# Outputs
# =============================================================================

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "database_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "s3_bucket_name" {
  value = aws_s3_bucket.code_storage.id
}

output "ecr_worker_repository" {
  value = aws_ecr_repository.worker.repository_url
}

output "ecr_runner_repository" {
  value = aws_ecr_repository.runner.repository_url
}

