package com.arvirtualtryon.services;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.ProductCategory;

import java.util.List;

/**
 * Interface defining the contract for product-related operations.
 * Helps in decoupling service implementations from their usage.
 */
public interface ProductService {

    /**
     * Fetch all products.
     *
     * @return A list of all product response DTOs.
     */
    List<ProductResponseDTO> getAllProducts();

    /**
     * Fetch a product by its ID.
     *
     * @param id The ID of the product.
     * @return The product response DTO with the specified ID.
     */
    ProductResponseDTO getProductById(Long id);

    /**
     * Fetch products by category.
     *
     * @param category The category of the products.
     * @return A list of product response DTOs belonging to the specified category.
     */
    List<ProductResponseDTO> getProductsByCategory(ProductCategory category);

    /**
     * Create a new product.
     *
     * @param productRequestDTO The product request DTO with creation details.
     * @return The newly created product response DTO.
     */
    ProductResponseDTO createProduct(ProductRequestDTO productRequestDTO);

    /**
     * Update an existing product.
     *
     * @param id The ID of the product to update.
     * @param productRequestDTO The updated product details.
     * @return The updated product response DTO.
     */
    ProductResponseDTO updateProduct(Long id, ProductRequestDTO productRequestDTO);

    /**
     * Delete a product by its ID.
     *
     * @param id The ID of the product to delete.
     */
    void deleteProduct(Long id);
}
