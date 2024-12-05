package com.arvirtualtryon.services.impl;

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
 * Implementation of the ProductService interface for managing products.
 * Provides business logic for handling product operations.
 */
@Service
public class ProductServiceImpl implements ProductService {

    private final ProductRepository productRepository;
    private static final String BASE_URL = "http://localhost:8080/api/resources/";

    /**
     * Constructor for injecting the ProductRepository dependency.
     *
     * @param productRepository Repository for accessing product data.
     */
    @Autowired
    public ProductServiceImpl(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    /**
     * Retrieve all products and convert them into response DTOs.
     *
     * @return List of ProductResponseDTOs for all products.
     */
    @Override
    public List<ProductResponseDTO> getAllProducts() {
        return productRepository.findAll()
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    /**
     * Retrieve a product by its ID and convert it into a response DTO.
     *
     * @param id Product ID.
     * @return ProductResponseDTO for the product.
     * @throws EntityNotFoundException If the product is not found.
     */
    @Override
    public ProductResponseDTO getProductById(Long id) {
        Product product = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));
        return mapToResponseDTO(product);
    }

    /**
     * Retrieve products by category and convert them into response DTOs.
     *
     * @param category ProductCategory to filter by.
     * @return List of ProductResponseDTOs in the specified category.
     */
    @Override
    public List<ProductResponseDTO> getProductsByCategory(ProductCategory category) {
        return productRepository.findByCategory(category)
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    /**
     * Create a new product using a request DTO and return the response DTO.
     *
     * @param productRequestDTO Data for creating the product.
     * @return ProductResponseDTO for the created product.
     */
    @Override
    public ProductResponseDTO createProduct(ProductRequestDTO productRequestDTO) {
        Product product = mapToEntity(productRequestDTO);
        Product savedProduct = productRepository.save(product);
        return mapToResponseDTO(savedProduct);
    }

    /**
     * Update an existing product by ID using a request DTO and return the response DTO.
     *
     * @param id                Product ID.
     * @param productRequestDTO Updated product details.
     * @return ProductResponseDTO for the updated product.
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
     * @param id Product ID.
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
     * Map a Product entity to a ProductResponseDTO with dynamic URL generation.
     *
     * @param product Product entity to map.
     * @return Corresponding ProductResponseDTO.
     */
    private ProductResponseDTO mapToResponseDTO(Product product) {
        ProductResponseDTO dto = new ProductResponseDTO();
        dto.setId(product.getId());
        dto.setName(product.getName());
        dto.setCategory(product.getCategory());
        dto.setModelUrl(BASE_URL + product.getModelUrl()); // Generate dynamic URL for model
        dto.setTextureUrl(
                product.getTextureUrl() != null ? BASE_URL + product.getTextureUrl() : null); // Handle optional textures
        return dto;
    }

    /**
     * Map a ProductRequestDTO to a Product entity.
     *
     * @param dto ProductRequestDTO to map.
     * @return Corresponding Product entity.
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
