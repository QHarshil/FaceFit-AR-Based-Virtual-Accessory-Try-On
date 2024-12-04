package com.arvirtualtryon.services.impl;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.repositories.ProductRepository;
import com.arvirtualtryon.services.ProductService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;package com.arvirtualtryon.services.impl;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;
import com.arvirtualtryon.repositories.ProductRepository;
import com.arvirtualtryon.services.ProductService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Service class for managing products.
 * Provides implementation for product-related business logic.
 */
@Service
public class ProductServiceImpl implements ProductService {

    private final ProductRepository productRepository;

    /**
     * Constructor for injecting dependencies.
     *
     * @param productRepository The repository for product data access.
     */
    @Autowired
    public ProductServiceImpl(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * Retrieve all products as response DTOs.
     *
     * @return A list of all product response DTOs.
     */
    @Override
    public List<ProductResponseDTO> getAllProducts() {
        return productRepository.findAll()
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    /**
     * Retrieve a product by its ID as a response DTO.
     *
     * @param id The ID of the product.
     * @return The product response DTO with the specified ID.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public ProductResponseDTO getProductById(Long id) {
        Product product = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));
        return mapToResponseDTO(product);
    }

    /**
     * Retrieve products by category as response DTOs.
     *
     * @param category The category of the products.
     * @return A list of product response DTOs in the specified category.
     */
    @Override
    public List<ProductResponseDTO> getProductsByCategory(ProductCategory category) {
        return productRepository.findByCategory(category)
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    /**
     * Create a new product using a request DTO.
     *
     * @param productRequestDTO The product request DTO with creation details.
     * @return The newly created product response DTO.
     */
    @Override
    public ProductResponseDTO createProduct(ProductRequestDTO productRequestDTO) {
        Product product = mapToEntity(productRequestDTO);
        Product savedProduct = productRepository.save(product);
        return mapToResponseDTO(savedProduct);
    }

    /**
     * Update an existing product using a request DTO.
     *
     * @param id The ID of the product to update.
     * @param productRequestDTO The updated product details.
     * @return The updated product response DTO.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public ProductResponseDTO updateProduct(Long id, ProductRequestDTO productRequestDTO) {
        Product existingProduct = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));

        existingProduct.setName(productRequestDTO.getName());
        existingProduct.setCategory(productRequestDTO.getCategory());
        existingProduct.setModelUrl(productRequestDTO.getModelUrl());
        existingProduct.setTextureUrl(productRequestDTO.getTextureUrl());

        Product updatedProduct = productRepository.save(existingProduct);
        return mapToResponseDTO(updatedProduct);
    }

    /**
     * Delete a product by its ID.
     *
     * @param id The ID of the product to delete.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public void deleteProduct(Long id) {
        if (!productRepository.existsById(id)) {
            throw new EntityNotFoundException("Product with ID " + id + " not found");
        }
        productRepository.deleteById(id);
    }

    /**
     * Map a Product entity to a ProductResponseDTO.
     *
     * @param product The Product entity to map.
     * @return The corresponding ProductResponseDTO.
     */
    private ProductResponseDTO mapToResponseDTO(Product product) {
        ProductResponseDTO dto = new ProductResponseDTO();
        dto.setId(product.getId());
        dto.setName(product.getName());
        dto.setCategory(product.getCategory());
        dto.setModelUrl(product.getModelUrl());
        dto.setTextureUrl(product.getTextureUrl());
        return dto;
    }

    /**
     * Map a ProductRequestDTO to a Product entity.
     *
     * @param dto The ProductRequestDTO to map.
     * @return The corresponding Product entity.
     */
    private Product mapToEntity(ProductRequestDTO dto) {
        Product product = new Product();
        product.setName(dto.getName());
        product.setCategory(dto.getCategory());
        product.setModelUrl(dto.getModelUrl());
        product.setTextureUrl(dto.getTextureUrl());
        return product;
    }
}


/**
 * Service class for managing products.
 * Provides implementation for product-related business logic.
 */
@Service
public class ProductServiceImpl implements ProductService {

    private final ProductRepository productRepository;

    /**
     * Constructor for injecting dependencies.
     *
     * @param productRepository The repository for product data access.
     */
    @Autowired
    public ProductServiceImpl(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * Retrieve all products.
     *
     * @return A list of all products.
     */
    @Override
    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }

    /**
     * Retrieve a product by its ID.
     *
     * @param id The ID of the product.
     * @return The product with the specified ID.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public Product getProductById(Long id) {
        return productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));
    }

    /**
     * Retrieve products by category.
     *
     * @param category The category of the products.
     * @return A list of products in the specified category.
     */
    @Override
    public List<Product> getProductsByCategory(ProductCategory category) {
        return productRepository.findByCategory(category);
    }

    /**
     * Retrieve products by a specific tag.
     *
     * @param tag The tag to search for.
     * @return A list of products with the specified tag.
     */
    @Override
    public List<Product> getProductsByTag(String tag) {
        return productRepository.findByTagsContaining(tag);
    }

    /**
     * Create a new product.
     *
     * @param product The product to create.
     * @return The created product.
     */
    @Override
    public Product createProduct(Product product) {
        return productRepository.save(product);
    }

    /**
     * Update an existing product.
     *
     * @param id The ID of the product to update.
     * @param updatedProduct The updated product details.
     * @return The updated product.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public Product updateProduct(Long id, Product updatedProduct) {
        Product existingProduct = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));

        // Update fields
        existingProduct.setName(updatedProduct.getName());
        existingProduct.setCategory(updatedProduct.getCategory());
        existingProduct.setModelUrl(updatedProduct.getModelUrl());
        existingProduct.setTextureUrl(updatedProduct.getTextureUrl());
        existingProduct.setTags(updatedProduct.getTags());
        existingProduct.setDimensions(updatedProduct.getDimensions());

        return productRepository.save(existingProduct);
    }

    /**
     * Delete a product by its ID.
     *
     * @param id The ID of the product to delete.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public void deleteProduct(Long id) {
        if (!productRepository.existsById(id)) {
            throw new EntityNotFoundException("Product with ID " + id + " not found");
        }
        productRepository.deleteById(id);
    }
}
