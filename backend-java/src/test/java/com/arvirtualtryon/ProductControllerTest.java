package com.arvirtualtryon.controllers;

import com.arvirtualtryon.dtos.ProductRequestDTO;
import com.arvirtualtryon.dtos.ProductResponseDTO;
import com.arvirtualtryon.services.CategoryService;
import com.arvirtualtryon.services.ProductService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Arrays;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ProductController.class)
public class ProductControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ProductService productService;

    @MockBean
    private CategoryService categoryService;

    @Autowired
    private ObjectMapper objectMapper;

    private ProductResponseDTO productResponseDTO;
    private ProductRequestDTO productRequestDTO;

    @BeforeEach
    public void setUp() {
        productResponseDTO = new ProductResponseDTO();
        productResponseDTO.setId(1L);
        productResponseDTO.setName("Test Product");
        productResponseDTO.setCategory("Test Category");
        productResponseDTO.setModelUrl("http://localhost:8080/test-model.gltf");

        productRequestDTO = new ProductRequestDTO();
        productRequestDTO.setName("New Product");
        productRequestDTO.setCategory("New Category");
        productRequestDTO.setModelUrl("http://localhost:8080/new-model.gltf");
    }

    @Test
    public void testGetAllProducts() throws Exception {
        List<ProductResponseDTO> products = Arrays.asList(productResponseDTO);
        when(productService.getAllProducts()).thenReturn(products);

        mockMvc.perform(get("/api/products"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Test Product"));
    }

    @Test
    public void testGetProductById() throws Exception {
        when(productService.getProductById(1L)).thenReturn(productResponseDTO);

        mockMvc.perform(get("/api/products/1"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.name").value("Test Product"));
    }

    @Test
    public void testCreateProduct() throws Exception {
        when(productService.createProduct(any(ProductRequestDTO.class))).thenReturn(productResponseDTO);

        mockMvc.perform(post("/api/products")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(productRequestDTO)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Test Product"));
    }

    @Test
    public void testUpdateProduct() throws Exception {
        when(productService.updateProduct(eq(1L), any(ProductRequestDTO.class))).thenReturn(productResponseDTO);

        mockMvc.perform(put("/api/products/1")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(productRequestDTO)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Test Product"));
    }

    @Test
    public void testDeleteProduct() throws Exception {
        doNothing().when(productService).deleteProduct(1L);

        mockMvc.perform(delete("/api/products/1"))
                .andExpect(status().isOk());
    }
}