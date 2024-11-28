package com.arvirtualtryon.integration;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.services.ProductService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Transactional
@ActiveProfiles("test")
class ProductServiceIntegrationTest {

    @Autowired
    private ProductService productService;

    @Test
    void createAndRetrieveProduct() {
        // Arrange
        Product product = new Product();
        product.setName("Integration Test Product");
        product.setCategory(ProductCategory.GLASSES);
        product.setModelUrl("http://example.com/model.glb");
        product.setCreatedAt(LocalDateTime.now());
        product.setUpdatedAt(LocalDateTime.now());

        // Act
        Product saved = productService.createProduct(product);
        Product retrieved = productService.getProductById(saved.getId());

        // Assert
        assertThat(retrieved).isNotNull();
        assertThat(retrieved.getName()).isEqualTo("Integration Test Product");
    }
}