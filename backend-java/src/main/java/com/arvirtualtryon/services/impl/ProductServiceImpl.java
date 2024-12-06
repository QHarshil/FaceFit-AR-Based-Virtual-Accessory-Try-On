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
    private static final String BASE_URL = "http://localhost:8080/api/resources/";

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

            for (File modelDir : categoryDir.listFiles(File::isDirectory)) {
                String modelName = modelDir.getName();
                String modelUrl = null;
                String binUrl = null;
                List<String> textureUrls = new ArrayList<>();

                for (File file : modelDir.listFiles()) {
                    if (file.isFile()) {
                        if (file.getName().endsWith(".gltf")) {
                            modelUrl = BASE_URL + file.getPath().replace("\\", "/");
                        } else if (file.getName().endsWith(".bin")) {
                            binUrl = BASE_URL + file.getPath().replace("\\", "/");
                        }
                    } else if (file.isDirectory() && file.getName().equalsIgnoreCase("textures")) {
                        for (File texture : file.listFiles()) {
                            textureUrls.add(BASE_URL + texture.getPath().replace("\\", "/"));
                        }
                    }
                }

                if (modelUrl == null) {
                    System.out.println("Skipping model folder without .gltf file: " + modelName);
                    continue;
                }

                Optional<Product> existingProduct = productRepository.findByModelUrl(modelUrl);
                if (existingProduct.isPresent()) {
                    Product product = existingProduct.get();
                    product.setTextureUrls(textureUrls);
                    productRepository.save(product);
                } else {
                    Product product = new Product();
                    product.setName(modelName);
                    product.setCategory(category);
                    product.setModelUrl(modelUrl);
                    product.setBinUrl(binUrl);
                    product.setTextureUrls(textureUrls);
                    productRepository.save(product);
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
        dto.setModelUrl(BASE_URL + product.getModelUrl());
        dto.setTextureUrls(product.getTextureUrls());
        dto.setBinUrl(product.getBinUrl());
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
