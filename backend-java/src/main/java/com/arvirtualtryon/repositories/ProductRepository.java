package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository interface for Product entity.
 * Provides CRUD operations and custom query support.
 */
@Repository
public interface ProductRepository extends JpaRepository<Product, Long> {
    /**
     * Find all products by their category.
     * @param category The category to search for.
     * @return A list of products belonging to the specified category.
     */
    List<Product> findByCategory(ProductCategory category);
}
