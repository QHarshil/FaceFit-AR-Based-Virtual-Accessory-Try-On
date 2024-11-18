package com.arvirtualtryon.repositories;

import com.arvirtualtryon.models.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * Repository interface for User entity.
 * Provides CRUD operations and custom query support.
 */
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    /**
     * Find a user by their email address.
     * @param email The email of the user.
     * @return An Optional containing the user, if found.
     */
    Optional<User> findByEmail(String email);

    /**
     * Find a user by their username.
     * @param username The username of the user.
     * @return An Optional containing the user, if found.
     */
    Optional<User> findByUsername(String username);
}
