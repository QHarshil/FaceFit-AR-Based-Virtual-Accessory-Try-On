package com.arvirtualtryon.services.impl;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.repositories.CategoryRepository;
import com.arvirtualtryon.repositories.ProductRepository;
import com.arvirtualtryon.services.ProductService;
import jakarta.persistence.EntityNotFoundException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class ProductServiceImpl implements ProductService {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;
    private static final String BASE_URL = "http://localhost:8081/api/resources/";

    @Autowired
    public ProductServiceImpl(ProductRepository productRepository, CategoryRepository categoryRepository) {
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
    }

    @Override
    public List<ProductResponseDTO> getAllProducts() {
        return productRepository.findAll()
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    @Override
    public ProductResponseDTO getProductById(Long id) {
        Product product = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));
        return mapToResponseDTO(product);
    }

    @Override
    public List<ProductResponseDTO> getProductsByCategory(Category category) {
        return productRepository.findByCategory(category)
                .stream()
                .map(this::mapToResponseDTO)
                .collect(Collectors.toList());
    }

    @Override
    public ProductResponseDTO createProduct(ProductRequestDTO productRequestDTO) {
        Product product = mapToEntity(productRequestDTO);
        Product savedProduct = productRepository.save(product);
        return mapToResponseDTO(savedProduct);
    }

    @Override
    public ProductResponseDTO updateProduct(Long id, ProductRequestDTO productRequestDTO) {
        Product existingProduct = productRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Product with ID " + id + " not found"));

        existingProduct.setName(productRequestDTO.getName());
        existingProduct.setCategory(findOrCreateCategory(productRequestDTO.getCategory()));
        existingProduct.setModelUrl(productRequestDTO.getModelUrl());
        existingProduct.setTextureUrls(productRequestDTO.getTextureUrls());
        existingProduct.setBinUrl(productRequestDTO.getBinUrl());

        Product updatedProduct = productRepository.save(existingProduct);
        return mapToResponseDTO(updatedProduct);
    }

    @Override
    public void deleteProduct(Long id) {
        if (!productRepository.existsById(id)) {
            throw new EntityNotFoundException("Product with ID " + id + " not found");
        }
        productRepository.deleteById(id);
    }

    @Override
    public void addOrUpdateProductsFromDirectory(String directoryPath) {
        File baseDir = new File(directoryPath);
        if (!baseDir.exists() || !baseDir.isDirectory()) {
            throw new IllegalArgumentException("Invalid base path: " + directoryPath);
        }

        for (File categoryDir : baseDir.listFiles(File::isDirectory)) {
            String categoryName = categoryDir.getName();
            Category category = findOrCreateCategory(categoryName);

            for (File modelFile : categoryDir.listFiles()) {
                if (modelFile.isFile() && (modelFile.getName().endsWith(".gltf") || modelFile.getName().endsWith(".glb"))) {
                    String modelName = modelFile.getName().split("\\.")[0]; // Use filename without extension as model name
                    String modelUrl = BASE_URL + categoryName + "/" + modelFile.getName();

                    ProductRequestDTO productRequest = new ProductRequestDTO();
                    productRequest.setName(modelName);
                    productRequest.setCategory(categoryName);
                    productRequest.setModelUrl(modelUrl);
                    productRequest.setBinUrl(null); // No .bin files expected in this structure
                    productRequest.setTextureUrls(new ArrayList<>()); // Textures are not part of the current structure

                    Optional<Product> existingProduct = productRepository.findByModelUrl(modelUrl);
                    if (existingProduct.isPresent()) {
                        Product product = existingProduct.get();
                        productRepository.save(product);
                    } else {
                        createProduct(productRequest);
                    }
                }
            }
        }
    }

    @Override
    public Category findOrCreateCategory(String name) {
        return categoryRepository.findByName(name)
                .orElseGet(() -> {
                    Category category = new Category(name);
                    return categoryRepository.save(category);
                });
    }

    private ProductResponseDTO mapToResponseDTO(Product product) {
        ProductResponseDTO dto = new ProductResponseDTO();
        dto.setId(product.getId());
        dto.setName(product.getName());
        dto.setCategory(product.getCategory().getName());
        dto.setModelUrl(product.getModelUrl()); // Use the stored model URL directly
        dto.setTextureUrls(product.getTextureUrls()); // Use stored texture URLs (if any)
        dto.setBinUrl(product.getBinUrl()); // Use stored .bin URL (if any)
        return dto;
    }

    private Product mapToEntity(ProductRequestDTO dto) {
        Product product = new Product();
        product.setName(dto.getName());
        product.setCategory(findOrCreateCategory(dto.getCategory()));
        product.setModelUrl(dto.getModelUrl());
        product.setTextureUrls(dto.getTextureUrls());
        product.setBinUrl(dto.getBinUrl());
        return product;
    }
}
