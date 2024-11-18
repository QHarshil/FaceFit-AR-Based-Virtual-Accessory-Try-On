package com.arvirtualtryon.services.impl;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.repositories.ProductRepository;
import com.arvirtualtryon.services.ProductService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Service class for product-related operations.
 */
@Service
public class ProductServiceImpl implements ProductService {

    private final ProductRepository productRepository;

    @Autowired
    public ProductServiceImpl(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    @Override
    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }

    @Override
    public Product getProductById(Long id) {
        return productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));
    }

    @Override
    public List<Product> getProductsByCategory(ProductCategory category) {
        return productRepository.findByCategory(category);
    }

    @Override
    public Product createProduct(Product product) {
        return productRepository.save(product);
    }

    @Override
    public Product updateProduct(Long id, Product updatedProduct) {
        Product existingProduct = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));

        // Update fields
        existingProduct.setName(updatedProduct.getName());
        existingProduct.setCategory(updatedProduct.getCategory());
        existingProduct.setModelUrl(updatedProduct.getModelUrl());
        existingProduct.setTextureUrl(updatedProduct.getTextureUrl());

        return productRepository.save(existingProduct);
    }

    @Override
    public void deleteProduct(Long id) {
        if (!productRepository.existsById(id)) {
            throw new EntityNotFoundException("Product with ID " + id + " not found");
        }
        productRepository.deleteById(id);
    }
}