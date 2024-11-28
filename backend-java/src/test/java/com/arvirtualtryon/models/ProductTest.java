package com.arvirtualtryon.models;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

class ProductTest {
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        ValidatorFactory factory = Validation.buildDefaultValidatorFactory();
        validator = factory.getValidator();
    }

    @Test
    void testProductCreation() {
        // Arrange
        Product product = new Product();
        LocalDateTime now = LocalDateTime.now();
        
        // Act
        product.setId(1L);
        product.setName("Test Glasses");
        product.setCategory(ProductCategory.GLASSES);
        product.setModelUrl("https://example.com/model.glb");
        product.setTextureUrl("https://example.com/texture.png");
        product.setCreatedAt(now);
        product.setUpdatedAt(now);

        // Assert
        assertEquals(1L, product.getId());
        assertEquals("Test Glasses", product.getName());
        assertEquals(ProductCategory.GLASSES, product.getCategory());
        assertEquals("https://example.com/model.glb", product.getModelUrl());
        assertEquals("https://example.com/texture.png", product.getTextureUrl());
        assertEquals(now, product.getCreatedAt());
        assertEquals(now, product.getUpdatedAt());
    }

    @Test
    void testNameValidation() {
        // Arrange
        Product product = new Product();
        product.setCategory(ProductCategory.GLASSES);
        product.setModelUrl("https://example.com/model.glb");

        // Act & Assert
        // Test empty name
        product.setName("");
        var violations = validator.validate(product);
        assertFalse(violations.isEmpty());
        assertTrue(violations.stream()
            .anyMatch(v -> v.getPropertyPath().toString().equals("name")));

        // Test valid name
        product.setName("Valid Name");
        violations = validator.validate(product);
        assertTrue(violations.stream()
            .noneMatch(v -> v.getPropertyPath().toString().equals("name")));
    }

    @Test
    void testModelUrlValidation() {
        // Arrange
        Product product = new Product();
        product.setName("Test Product");
        product.setCategory(ProductCategory.GLASSES);

        // Act & Assert
        // Test empty modelUrl
        product.setModelUrl("");
        var violations = validator.validate(product);
        assertFalse(violations.isEmpty());
        assertTrue(violations.stream()
            .anyMatch(v -> v.getPropertyPath().toString().equals("modelUrl")));

        // Test valid modelUrl
        product.setModelUrl("https://example.com/model.glb");
        violations = validator.validate(product);
        assertTrue(violations.stream()
            .noneMatch(v -> v.getPropertyPath().toString().equals("modelUrl")));
    }

    @Test
    void testOptionalTextureUrl() {
        // Arrange
        Product product = new Product();
        product.setName("Test Product");
        product.setCategory(ProductCategory.GLASSES);
        product.setModelUrl("https://example.com/model.glb");

        // Act & Assert
        // Test null textureUrl
        product.setTextureUrl(null);
        var violations = validator.validate(product);
        assertTrue(violations.stream()
            .noneMatch(v -> v.getPropertyPath().toString().equals("textureUrl")));

        // Test with textureUrl
        product.setTextureUrl("https://example.com/texture.png");
        violations = validator.validate(product);
        assertTrue(violations.stream()
            .noneMatch(v -> v.getPropertyPath().toString().equals("textureUrl")));
    }
}