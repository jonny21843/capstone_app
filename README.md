# Overview

This project is a secure, cloud-based file management web application built as part of my graduate capstone. It allows users to upload, browse, search, and download files organized by field and category classifications, while enforcing private S3 access through presigned URLs and IAM roles.

The application demonstrates real-world AWS architecture patterns including:

- Private S3 buckets
- IAM role–based access
- Presigned URL uploads and downloads
- Reverse proxying with Nginx
- Separation of static frontend and API backend

# Key Design Goals

- No public S3 access
- No AWS credentials exposed to users
- Scalable separation of frontend and backend
- Secure file handling using presigned URLs

# Technology Stack

## Frontend
- HTML
- CSS
- JavaScript
- Hosted via Nginx on EC2

## Backend API
- Python 3.9
- Flask
- Boto3 (AWS SDK)
- Systemd service (presign-api.service)

## AWS Services
- Amazon EC2
- Amazon S3 (private buckets)
- IAM (instance roles)

## AWS Network Infrastructure

The application is deployed within an AWS Virtual Private Cloud (VPC) to provide network-level isolation and security. Core networking components are managed outside of this code repository. 

The network design includes:
- A dedicated VPC for application resources
- Public and private subnets to separate external access from internal services
- Security groups enforcing least-privilege inbound and outbound traffic
- VPC endpoints for private access to AWS services such as Amazon S3
- Route tables and VPC peering for routing network traffic privately and publicly. 

This network configuration ensures that application components communicate securely while minimizing exposure to the public internet.

# Cloudflare Zero Trust & Domain Integration

This project uses Cloudflare Zero Trust in combination with a custom domain to securely expose application functionality while keeping underlying AWS infrastructure private. Rather than exposing EC2 instances or APIs directly via public IPs, all access is routed through Cloudflare’s edge network and governed by identity-based policies.

## Core Cloudflare Zero Trust Components Used

- Cloudflare Tunnel (cloudflared)
- Zero Trust Access Policies (identity-based access control)
- Domain routing

Together, these components ensure that application access is authenticated and authorized before reaching AWS resources, while keeping the underlying infrastructure private and protected.
