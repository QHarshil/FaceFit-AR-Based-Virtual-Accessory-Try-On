package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.models.Product;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
public class ProductRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private CategoryRepository categoryRepository;

    private Category category;

    @BeforeEach
    public void setUp() {
        category = new Category("Test Category");
        entityManager.persist(category);
        entityManager.flush();
    }

    @Test
    public void testFindByCategory() {
        // Create products
        Product product1 = new Product();
        product1.setName("Product 1");
        product1.setCategory(category);
        product1.setModelUrl("http://localhost/model1.gltf");

        Product product2 = new Product();
        product2.setName("Product 2");
        product2.setCategory(category);
        product2.setModelUrl("http://localhost/model2.gltf");

        entityManager.persist(product1);
        entityManager.persist(product2);
        entityManager.flush();

        // Find products by category
        List<Product> products = productRepository.findByCategory(category);

        assertEquals(2, products.size());
        assertTrue(products.stream().anyMatch(p -> p.getName().equals("Product 1")));
        assertTrue(products.stream().anyMatch(p -> p.getName().equals("Product 2")));
    }

    @Test
    public void testFindByModelUrl() {
        // Create a product
        Product product = new Product();
        product.setName("Test Product");
        product.setCategory(category);
        product.setModelUrl("http://localhost/test-model.gltf");

        entityManager.persist(product);
        entityManager.flush();

        // Find product by model URL
        Optional<Product> found = productRepository.findByModelUrl("http://localhost/test-model.gltf");

        assertTrue(found.isPresent());
        assertEquals("Test Product", found.get().getName());
    }

    @Test
    public void testFindByModelUrl_NotExists() {
        Optional<Product> found = productRepository.findByModelUrl("http://localhost/nonexistent.gltf");
        assertFalse(found.isPresent());
    }
}