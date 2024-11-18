package com.arvirtualtryon.services;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;

import java.util.List;

/* Interface defining the contract for product-related operations.
 * Helps in decoupling service implementations from their usage.
 */
public interface ProductService {

    // Fetch all products
    List<Product> getAllProducts();

    // Fetch a product by its ID
    Product getProductById(Long id);

    // Fetch products by category
    List<Product> getProductsByCategory(ProductCategory category);

    // Create a new product
    Product createProduct(Product product);

    // Update an existing product
    Product updateProduct(Long id, Product updatedProduct);

    // Delete a product by its ID
    void deleteProduct(Long id);
}