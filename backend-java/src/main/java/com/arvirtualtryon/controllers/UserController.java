package com.arvirtualtryon.controllers;

import com.arvirtualtryon.dtos.LoginRequest;
import com.arvirtualtryon.models.User;
import com.arvirtualtryon.services.IUserService;
import com.arvirtualtryon.utils.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/users")
@CrossOrigin(origins = "http://localhost:3000")
public class UserController {

    private final IUserService userService;
    private final JwtUtil jwtUtil;

    @Autowired
    public UserController(IUserService userService, JwtUtil jwtUtil) {
        this.userService = userService;
        this.jwtUtil = jwtUtil;
    }

    @PostMapping("/register")
    public ResponseEntity<?> registerUser(@Valid @RequestBody User user) {
        try {
            User createdUser = userService.createUser(user);
            return ResponseEntity.status(HttpStatus.CREATED).body(createdUser);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> loginUser(@Valid @RequestBody LoginRequest loginRequest) {
        try {
            User user = userService.getUserByEmail(loginRequest.getEmail());
            if (user != null) {
                System.out.println("User found: " + user.getEmail()); // Debug
                if (userService.verifyPassword(loginRequest.getPassword(), user.getPassword())) {
                    String token = jwtUtil.generateToken(user.getEmail());
                    return ResponseEntity.ok().body(token);
                } else {
                    System.out.println("Invalid password"); // Debug
                    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid email or password");
                }
            }
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid email or password");
        } catch (Exception e) {
            e.printStackTrace(); // Debug
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Login failed: " + e.getMessage());
        }
    }
}
