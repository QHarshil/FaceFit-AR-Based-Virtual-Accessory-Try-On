package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class ProductRepositoryTest {

    @Autowired
    private ProductRepository productRepository;

    @Test
    void findByCategory_ShouldReturnMatchingProducts() {
        // Arrange
        Product product = new Product();
        product.setName("Test Glasses");
        product.setCategory(ProductCategory.GLASSES);
        product.setModelUrl("http://example.com/model.glb");
        product.setCreatedAt(LocalDateTime.now());
        product.setUpdatedAt(LocalDateTime.now());
        productRepository.save(product);

        // Act
        List<Product> found = productRepository.findByCategory(ProductCategory.GLASSES);

        // Assert
        assertThat(found).hasSize(1);
        assertThat(found.get(0).getName()).isEqualTo("Test Glasses");
    }

    @Test
    void findByCategory_ShouldReturnEmptyList_WhenNoCategoryMatch() {
        // Act
        List<Product> found = productRepository.findByCategory(ProductCategory.HAT);

        // Assert
        assertThat(found).isEmpty();
    }
}