# AR Virtual Try-On Backend

This is the backend service for the AR Virtual Try-On application. It provides APIs for managing users, products, and their respective functionalities. The backend is built with **Spring Boot** and follows a modular, scalable, and industry-standard design.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Features](#features)
3. [Directory Structure](#directory-structure)
4. [Steps To Run](#steps-to-run)
5. [API Endpoints](#api-endpoints)

---

## Tech Stack

- **Java 17**
- **Spring Boot 3.x**
- **Hibernate (JPA)**
- **PostgreSQL** (Database)
- **Maven** (Build tool)
- **Jakarta Validation** (Validation framework)

---

## Features

- **User Management**: CRUD operations for managing users.
- **Product Management**: CRUD operations for managing AR products, including categorization and custom attributes.
- **Service Layer Abstraction**: Separation of business logic using interfaces and implementation classes.
- **Scalable Design**: Modular OOP code adhering to industry standards.
- **Error Handling**: Custom exceptions and detailed error messages for robustness.

---

## Directory Structure

```bash
src/main/java/com/arvirtualtryon/
├── models/                  # Entity classes for database mapping
│   ├── Product.java         # Product entity
│   ├── ProductCategory.java # Enum for product categories
│   └── User.java            # User entity
├── repositories/            # Data access layer
│   ├── ProductRepository.java
│   └── UserRepository.java
├── services/                # Business logic layer
│   ├── ProductService.java  # Interface for product services
│   ├── UserService.java     # Interface for user services
│   └── impl/                # Implementation of service interfaces
│       ├── ProductServiceImpl.java
│       └── UserServiceImpl.java
└── Application.java         # Main Spring Boot application entry point
```
---

## Prerequisites
  - **Java 17**
  - **Maven 3.6+**
  - **PostgreSQL** installed and running.

---

## Steps to Run

1. Clone the repository:
   ```bash
   git clone
   cd ar-virtual-tryon-backend

 2. Configure the database in application.properties:
    ```bash
    spring.datasource.url=jdbc:postgresql://localhost:5432/ar_virtual_tryon
    spring.datasource.username=your_db_username
    spring.datasource.password=your_db_password
    spring.jpa.hibernate.ddl-auto=update
    ```
3. Build the project:
     mvn clean install

4. Run the application:
    - mvn spring-boot:run
    - Access the application on http://localhost:8080.

## API Endpoints

  User Endpoints

    HTTP Method	Endpoint	Description
    GET	/users	Get all users.
    GET	/users/{id}	Get a user by ID.
    POST	/users	Create a new user.
    PUT	/users/{id}	Update an existing user.
    DELETE	/users/{id}	Delete a user by ID.
    
  Product Endpoints
  
    HTTP Method	Endpoint	Description
    GET	/products	Get all products.
    GET	/products/{id}	Get a product by ID.
    GET	/products/category/{category}	Get products by category.
    POST	/products	Create a new product.
    PUT	/products/{id}	Update an existing product.
    DELETE	/products/{id}	Delete a product by ID.

