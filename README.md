# Overview

This project is a secure, cloud-based file management web application built as part of my graduate capstone. It allows users to upload, browse, search, and download files organized by Field and Category, while enforcing private S3 access through presigned URLs and IAM roles.

The application demonstrates real-world AWS architecture patterns including:

Private S3 buckets

IAM role–based access

Presigned URL uploads/downloads

Reverse proxying with Nginx

Separation of static frontend and API backend

# Key Design Goals

No public S3 access

No AWS credentials exposed to users

Scalable separation of frontend and backend

Secure file handling using presigned URLs

# Technology Stack
Frontend

HTML

CSS

Vanilla JavaScript

Hosted via Nginx on EC2

Backend API

Python 3.9

Flask

Boto3 (AWS SDK)

Systemd service (presign-api.service)

AWS Services

Amazon EC2

Amazon S3 (private buckets)

IAM (instance roles)
 
VPC Gateway Endpoint for S3

# Deployment Summary
Dev Environment

Separate S3 bucket

Separate EC2 instance

Same architecture as production

Production Environment

Private S3 bucket

Nginx + Flask API on EC2

IAM roles enforced

Presigned URLs enabled
