package com.arvirtualtryon;

import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.repositories.CategoryRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class CategoryServiceImplTest {

    @Mock
    private CategoryRepository categoryRepository;

    @InjectMocks
    private CategoryServiceImpl categoryService;

    private Category category;

    @BeforeEach
    public void setUp() {
        category = new Category("Test Category");
        category.setId(1L);
    }

    @Test
    public void testGetAllCategories() {
        when(categoryRepository.findAll()).thenReturn(Arrays.asList(category));

        List<Category> categories = categoryService.getAllCategories();

        assertNotNull(categories);
        assertEquals(1, categories.size());
        assertEquals("Test Category", categories.get(0).getName());
    }

    @Test
    public void testGetCategoryByName() {
        when(categoryRepository.findByName("Test Category")).thenReturn(Optional.of(category));

        Category foundCategory = categoryService.getCategoryByName("Test Category");

        assertNotNull(foundCategory);
        assertEquals("Test Category", foundCategory.getName());
    }

    @Test
    public void testGetCategoryByName_NotFound() {
        when(categoryRepository.findByName("Nonexistent")).thenReturn(Optional.empty());

        assertThrows(EntityNotFoundException.class, () -> {
            categoryService.getCategoryByName("Nonexistent");
        });
    }

    @Test
    public void testCreateOrGetCategory_Existing() {
        when(categoryRepository.findByName("Test Category")).thenReturn(Optional.of(category));

        Category result = categoryService.createOrGetCategory("Test Category");

        assertEquals(category, result);
        verify(categoryRepository, never()).save(any(Category.class));
    }

    @Test
    public void testCreateOrGetCategory_New() {
        when(categoryRepository.findByName("New Category")).thenReturn(Optional.empty());
        when(categoryRepository.save(any(Category.class))).thenAnswer(invocation -> {
            Category savedCategory = invocation.getArgument(0);
            savedCategory.setId(2L);
            return savedCategory;
        });

        Category result = categoryService.createOrGetCategory("New Category");

        assertNotNull(result);
        assertEquals("New Category", result.getName());
        verify(categoryRepository).save(any(Category.class));
    }
}