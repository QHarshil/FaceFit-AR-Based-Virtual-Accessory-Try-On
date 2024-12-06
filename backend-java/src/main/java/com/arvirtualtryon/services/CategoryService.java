package com.arvirtualtryon.services;

import com.arvirtualtryon.models.Category;

import java.util.List;

/**
 * Interface defining the contract for category-related operations.
 * Helps in decoupling service implementations from their usage.
 */
public interface CategoryService {

    /**
     * Get all categories from the database.
     * 
     * @return A list of all categories.
     */
    List<Category> getAllCategories();

    /**
     * Get a category by its name.
     * 
     * @param name The name of the category.
     * @return The category if found.
     */
    Category getCategoryByName(String name);

    /**
     * Create or retrieve a category by name.
     * If the category doesn't exist, it will be created.
     * 
     * @param name The name of the category.
     * @return The created or existing category.
     */
    Category createOrGetCategory(String name);
}
