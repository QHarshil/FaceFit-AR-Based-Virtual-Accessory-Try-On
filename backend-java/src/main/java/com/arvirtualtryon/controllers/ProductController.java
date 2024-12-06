package com.arvirtualtryon.controllers;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.services.CategoryService;
import com.arvirtualtryon.services.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST Controller for managing products.
 * Provides endpoints for CRUD operations and product retrieval by category.
 */
@RestController
@RequestMapping("/api/products")
@CrossOrigin(origins = "http://localhost:3000") // Adjust based on frontend deployment
public class ProductController {

    private final ProductService productService;
    private final CategoryService categoryService;

    /**
     * Constructor for injecting dependencies.
     *
     * @param productService  Service layer for handling product operations.
     * @param categoryService Service layer for handling category operations.
     */
    @Autowired
    public ProductController(ProductService productService, CategoryService categoryService) {
        this.productService = productService;
        this.categoryService = categoryService;
    }

    /**
     * Retrieve all products.
     *
     * @return List of all products as ProductResponseDTOs.
     */
    @GetMapping
    public ResponseEntity<List<ProductResponseDTO>> getAllProducts() {
        List<ProductResponseDTO> products = productService.getAllProducts();
        return ResponseEntity.ok(products);
    }

    /**
     * Retrieve a product by its ID.
     *
     * @param id The ID of the product to retrieve.
     * @return ProductResponseDTO with the specified ID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<ProductResponseDTO> getProductById(@PathVariable Long id) {
        ProductResponseDTO product = productService.getProductById(id);
        return ResponseEntity.ok(product);
    }

    /**
     * Retrieve the model URL for a product by its ID.
     *
     * @param productId The ID of the product to retrieve the model for.
     * @return A map containing the model URL.
     */
    @GetMapping("/{productId}/model")
    public ResponseEntity<String> getModel(@PathVariable Long productId) {
        ProductResponseDTO product = productService.getProductById(productId);
        if (product.getModelUrl() == null || product.getModelUrl().isBlank()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body("Model URL not found for product ID " + productId);
        }
        return ResponseEntity.ok(product.getModelUrl());
    }

    /**
     * Retrieve products by their category.
     *
     * @param categoryName The category to filter products by.
     * @return List of products in the specified category as ProductResponseDTOs.
     */
    @GetMapping("/category/{categoryName}")
    public ResponseEntity<List<ProductResponseDTO>> getProductsByCategory(@PathVariable String categoryName) {
        Category category = categoryService.getCategoryByName(categoryName);
        List<ProductResponseDTO> products = productService.getProductsByCategory(category);
        return ResponseEntity.ok(products);
    }

    /**
     * Create a new product.
     *
     * @param productRequestDTO Data for creating the new product.
     * @return The newly created product as a ProductResponseDTO.
     */
    @PostMapping
    public ResponseEntity<ProductResponseDTO> createProduct(@RequestBody ProductRequestDTO productRequestDTO) {
        ProductResponseDTO createdProduct = productService.createProduct(productRequestDTO);
        return ResponseEntity.status(HttpStatus.CREATED).body(createdProduct);
    }

    /**
     * Update an existing product by its ID.
     *
     * @param id                The ID of the product to update.
     * @param productRequestDTO Updated data for the product.
     * @return The updated product as a ProductResponseDTO.
     */
    @PutMapping("/{id}")
    public ResponseEntity<ProductResponseDTO> updateProduct(@PathVariable Long id, @RequestBody ProductRequestDTO productRequestDTO) {
        ProductResponseDTO updatedProduct = productService.updateProduct(id, productRequestDTO);
        return ResponseEntity.ok(updatedProduct);
    }

    /**
     * Delete a product by its ID.
     *
     * @param id The ID of the product to delete.
     * @return HTTP 204 No Content response if the deletion is successful.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        productService.deleteProduct(id);
        return ResponseEntity.noContent().build();
    }

    /**
     * Retrieve all categories dynamically.
     *
     * @return List of all categories.
     */
    @GetMapping("/categories")
    public ResponseEntity<List<String>> getAllCategories() {
        List<String> categories = categoryService.getAllCategories()
                .stream()
                .map(Category::getName)
                .toList();
        return ResponseEntity.ok(categories);
    }
}
