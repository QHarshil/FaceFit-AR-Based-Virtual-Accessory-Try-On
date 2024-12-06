package com.arvirtualtryon.services.impl;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.models.Category;
import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.repositories.CategoryRepository;
import com.arvirtualtryon.repositories.ProductRepository;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class ProductServiceImplTest {

    @Mock
    private ProductRepository productRepository;

    @Mock
    private CategoryRepository categoryRepository;

    @InjectMocks
    private ProductServiceImpl productService;

    private Product product;
    private Category category;

    @BeforeEach
    public void setUp() {
        category = new Category("Test Category");
        category.setId(1L);

        product = new Product();
        product.setId(1L);
        product.setName("Test Product");
        product.setCategory(category);
        product.setModelUrl("http://localhost:8080/test-model.gltf");
    }

    @Test
    public void testGetAllProducts() {
        when(productRepository.findAll()).thenReturn(Arrays.asList(product));

        List<ProductResponseDTO> products = productService.getAllProducts();

        assertNotNull(products);
        assertEquals(1, products.size());
        assertEquals("Test Product", products.get(0).getName());
    }

    @Test
    public void testGetProductById() {
        when(productRepository.findById(1L)).thenReturn(Optional.of(product));

        ProductResponseDTO foundProduct = productService.getProductById(1L);

        assertNotNull(foundProduct);
        assertEquals("Test Product", foundProduct.getName());
    }

    @Test
    public void testGetProductById_NotFound() {
        when(productRepository.findById(1L)).thenReturn(Optional.empty());

        assertThrows(EntityNotFoundException.class, () -> {
            productService.getProductById(1L);
        });
    }

    @Test
    public void testCreateProduct() {
        ProductRequestDTO requestDTO = new ProductRequestDTO();
        requestDTO.setName("New Product");
        requestDTO.setCategory("Test Category");

        when(categoryRepository.findByName(anyString())).thenReturn(Optional.of(category));
        when(productRepository.save(any(Product.class))).thenReturn(product);

        ProductResponseDTO createdProduct = productService.createProduct(requestDTO);

        assertNotNull(createdProduct);
        assertEquals("Test Product", createdProduct.getName());
    }

    @Test
    public void testUpdateProduct() {
        ProductRequestDTO requestDTO = new ProductRequestDTO();
        requestDTO.setName("Updated Product");
        requestDTO.setCategory("Test Category");

        when(productRepository.findById(1L)).thenReturn(Optional.of(product));
        when(categoryRepository.findByName(anyString())).thenReturn(Optional.of(category));
        when(productRepository.save(any(Product.class))).thenReturn(product);

        ProductResponseDTO updatedProduct = productService.updateProduct(1L, requestDTO);

        assertNotNull(updatedProduct);
        assertEquals("Test Product", updatedProduct.getName());
    }

    @Test
    public void testDeleteProduct() {
        when(productRepository.existsById(1L)).thenReturn(true);
        doNothing().when(productRepository).deleteById(1L);

        assertDoesNotThrow(() -> productService.deleteProduct(1L));
    }

    @Test
    public void testDeleteProduct_NotFound() {
        when(productRepository.existsById(1L)).thenReturn(false);

        assertThrows(EntityNotFoundException.class, () -> {
            productService.deleteProduct(1L);
        });
    }
}