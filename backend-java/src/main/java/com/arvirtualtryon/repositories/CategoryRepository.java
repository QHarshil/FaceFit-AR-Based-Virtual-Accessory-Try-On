package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.Category;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * Repository interface for Category entity.
 * Provides basic CRUD operations and custom query support.
 */
@Repository
public interface CategoryRepository extends JpaRepository<Category, Long> {

    /**
     * Find a category by its name.
     * @param name The name of the category.
     * @return An Optional containing the category, if found.
     */
    Optional<Category> findByName(String name);
}
