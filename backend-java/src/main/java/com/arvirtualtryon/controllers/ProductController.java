package com.arvirtualtryon.controllers;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.services.ProductService;
import org.springframework.beans.factory.annotation.Autowired;
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

    /**
     * Constructor for injecting the ProductService dependency.
     *
     * @param productService Service layer for handling product operations.
     */
    @Autowired
    public ProductController(ProductService productService) {
        this.productService = productService;
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
     * Retrieve products by their category.
     *
     * @param category The category to filter products by (e.g., GLASSES, HATS).
     * @return List of products in the specified category as ProductResponseDTOs.
     */
    @GetMapping("/category/{category}")
    public ResponseEntity<List<ProductResponseDTO>> getProductsByCategory(@PathVariable String category) {
        ProductCategory productCategory = ProductCategory.valueOf(category.toUpperCase());
        List<ProductResponseDTO> products = productService.getProductsByCategory(productCategory);
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
        return ResponseEntity.ok(createdProduct);
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
     * @return HTTP 200 OK response if the deletion is successful.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProduct(@PathVariable Long id) {
        productService.deleteProduct(id);
        return ResponseEntity.ok().build();
    }
}
