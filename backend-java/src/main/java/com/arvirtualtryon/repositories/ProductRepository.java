package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.Product;
import com.arvirtualtryon.models.ProductCategory;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.List;

@Repository
public interface ProductRepository extends JpaRepository<Product, Long> {
    List<Product> findByCategory(ProductCategory category);

    Optional<Product> findByModelUrl(String modelUrl);
}
