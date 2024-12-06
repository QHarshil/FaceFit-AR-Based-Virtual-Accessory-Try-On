package com.arvirtualtryon.services;

import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;

import java.util.List;

public interface ProductService {
    List<ProductResponseDTO> getAllProducts();
    ProductResponseDTO getProductById(Long id);
    List<ProductResponseDTO> getProductsByCategory(Category category);
    ProductResponseDTO createProduct(ProductRequestDTO productRequestDTO);
    ProductResponseDTO updateProduct(Long id, ProductRequestDTO productRequestDTO);
    void deleteProduct(Long id);
    void addOrUpdateProductsFromDirectory(String directoryPath);
    Category findOrCreateCategory(String name);
}
