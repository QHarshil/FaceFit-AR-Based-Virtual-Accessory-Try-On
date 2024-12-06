package com.arvirtualtryon.services;

import com.arvirtualtryon.models.User;

import java.util.List;

/**
 * Interface defining the contract for user-related operations.
 * Helps in decoupling service implementations from their usage.
 */
public interface IUserService {

    /**
     * Fetches all users from the database.
     * @return A list of all users.
     */
    List<User> getAllUsers();

    /**
     * Fetches a user by their unique ID.
     * @param id The unique identifier of the user.
     * @return The user object if found.
     */
    User getUserById(Long id);

    /**
     * Fetches a user by their email.
     * @param email The email of the user.
     * @return The user object if found.
     */
    User getUserByEmail(String email);

    /**
     * Creates a new user in the database.
     * @param user The user object containing details of the new user.
     * @return The saved user object.
     */
    User createUser(User user);

    /**
     * Updates the details of an existing user.
     * @param id The unique identifier of the user to update.
     * @param updatedUser The user object containing updated details.
     * @return The updated user object.
     */
    User updateUser(Long id, User updatedUser);

    /**
     * Deletes a user from the database.
     * @param id The unique identifier of the user to delete.
     */
    void deleteUser(Long id);

    /**
     * Verifies if the raw password matches the encoded password.
     * @param rawPassword The plain text password.
     * @param encodedPassword The hashed password.
     * @return True if the password matches, otherwise false.
     */
    boolean verifyPassword(String rawPassword, String encodedPassword);
}
