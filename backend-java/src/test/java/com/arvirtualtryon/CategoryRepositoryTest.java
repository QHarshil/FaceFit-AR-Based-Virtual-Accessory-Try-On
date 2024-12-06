package com.arvirtualtryon;

import com.arvirtualtryon.models.Category;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
public class CategoryRepositoryTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private CategoryRepository categoryRepository;

    @Test
    public void testFindByName_Exists() {
        // Create a category
        Category category = new Category("Test Category");

        // Persist the category
        entityManager.persist(category);
        entityManager.flush();

        // Find the category by name
        Optional<Category> found = categoryRepository.findByName("Test Category");

        assertTrue(found.isPresent());
        assertEquals("Test Category", found.get().getName());
    }

    @Test
    public void testFindByName_NotExists() {
        Optional<Category> found = categoryRepository.findByName("Nonexistent Category");
        assertFalse(found.isPresent());
    }
}