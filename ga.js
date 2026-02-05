/**
 * Genetic Algorithm for Timetable Generation
 * Optimizes class scheduling with constraints for faculty, classrooms, and standards
 */

class GeneticAlgorithm {
  constructor(constraints) {
    this.constraints = constraints;
    this.populationSize = 100;
    this.generations = 300;
    this.mutationRate = 0.15;
    this.crossoverRate = 0.85;
    this.eliteSize = 8;
    this.tournamentSize = 5;

    // Parse constraints
    this.standards = constraints.standards;
    this.faculty = constraints.faculty;
    this.assignments = constraints.assignments;
    this.classrooms = constraints.classrooms;
    this.daysOfWeek = constraints.daysOfWeek;
    this.timeSlots = constraints.timeSlots;
  }

  /**
   * Main GA execution
   */
  run() {
    console.log('Starting GA with population:', this.populationSize);
    let population = this.initializePopulation();
    
    let bestSolution = null;
    let bestFitness = -Infinity;
    let noImprovementCount = 0;
    const maxNoImprovement = 50;

    for (let generation = 0; generation < this.generations; generation++) {
      // Evaluate fitness
      population.forEach(individual => {
        individual.fitness = this.evaluateFitness(individual);
        individual.conflicts = this.countAllConflicts(individual);
      });

      // Sort by fitness
      population.sort((a, b) => b.fitness - a.fitness);

      // Track best
      if (population[0].fitness > bestFitness) {
        bestFitness = population[0].fitness;
        bestSolution = JSON.parse(JSON.stringify(population[0]));
        noImprovementCount = 0;

        if (generation % 50 === 0) {
          console.log(`Gen ${generation}: Fitness=${bestFitness.toFixed(2)}, Conflicts=${bestSolution.conflicts}`);
        }
      } else {
        noImprovementCount++;
      }

      // Early stopping if no conflicts and no improvement
      if (bestSolution.conflicts === 0 && noImprovementCount > 20) {
        console.log(`Perfect solution found at generation ${generation}`);
        break;
      }

      // Create new generation
      const newPopulation = [];

      // Elite
      for (let i = 0; i < this.eliteSize && i < population.length; i++) {
        newPopulation.push(JSON.parse(JSON.stringify(population[i])));
      }

      // Generate rest
      while (newPopulation.length < this.populationSize) {
        const parent1 = this.tournamentSelection(population);
        const parent2 = this.tournamentSelection(population);

        let child = Math.random() < this.crossoverRate
          ? this.crossover(parent1, parent2)
          : JSON.parse(JSON.stringify(parent1));

        child = this.mutate(child);
        newPopulation.push(child);
      }

      population = newPopulation;
    }

    console.log('GA Complete - Best Fitness:', bestFitness.toFixed(2), 'Conflicts:', bestSolution.conflicts);
    return bestSolution;
  }

  /**
   * Initialize population with random valid individuals
   */
  initializePopulation() {
    const population = [];

    for (let i = 0; i < this.populationSize; i++) {
      const individual = {
        genes: [],
        fitness: 0,
        conflicts: 0
      };

      // Create gene for each course instance
      this.assignments.forEach((assignment, assignmentIdx) => {
        const timesPerWeek = parseInt(assignment.timesPerWeek);
        
        for (let instance = 0; instance < timesPerWeek; instance++) {
          const gene = {
            assignmentId: assignment.id,
            courseId: assignment.courseId,
            facultyId: assignment.facultyId,
            classroomIdx: Math.floor(Math.random() * this.classrooms.length),
            dayIdx: Math.floor(Math.random() * this.daysOfWeek.length),
            timeSlotIdx: Math.floor(Math.random() * this.timeSlots.length),
            instance: instance
          };
          individual.genes.push(gene);
        }
      });

      population.push(individual);
    }

    return population;
  }

  /**
   * Evaluate fitness of individual
   */
  evaluateFitness(individual) {
    const conflicts = this.countAllConflicts(individual);
    const distributionScore = this.evaluateDistribution(individual);
    
    // Heavily penalize conflicts
    const conflictPenalty = conflicts * 500;
    const fitness = distributionScore - conflictPenalty;

    return fitness;
  }

  /**
   * Count all constraint violations
   */
  countAllConflicts(individual) {
    let conflicts = 0;

    // Faculty conflicts
    conflicts += this.checkFacultyConflicts(individual);

    // Classroom conflicts
    conflicts += this.checkClassroomConflicts(individual);

    // Standard conflicts
    conflicts += this.checkStandardConflicts(individual);

    return conflicts;
  }

  /**
   * Check faculty teaching multiple classes at same time
   */
  checkFacultyConflicts(individual) {
    let conflicts = 0;
    const facultyMap = {};

    individual.genes.forEach(gene => {
      const key = `${gene.facultyId}-${gene.dayIdx}-${gene.timeSlotIdx}`;
      facultyMap[key] = (facultyMap[key] || 0) + 1;
    });

    Object.values(facultyMap).forEach(count => {
      if (count > 1) conflicts += (count - 1);
    });

    return conflicts;
  }

  /**
   * Check classroom used for multiple classes at same time
   */
  checkClassroomConflicts(individual) {
    let conflicts = 0;
    const classroomMap = {};

    individual.genes.forEach(gene => {
      const classroom = this.classrooms[gene.classroomIdx];
      const key = `${classroom}-${gene.dayIdx}-${gene.timeSlotIdx}`;
      classroomMap[key] = (classroomMap[key] || 0) + 1;
    });

    Object.values(classroomMap).forEach(count => {
      if (count > 1) conflicts += (count - 1);
    });

    return conflicts;
  }

  /**
   * Check standard attending multiple classes at same time
   */
  checkStandardConflicts(individual) {
    let conflicts = 0;
    const standardMap = {};

    individual.genes.forEach(gene => {
      const standard = this.findStandardByCourseId(gene.courseId);
      if (standard) {
        const key = `${standard.id}-${gene.dayIdx}-${gene.timeSlotIdx}`;
        standardMap[key] = (standardMap[key] || 0) + 1;
      }
    });

    Object.values(standardMap).forEach(count => {
      if (count > 1) conflicts += (count - 1);
    });

    return conflicts;
  }

  /**
   * Evaluate how well classes are distributed
   */
  evaluateDistribution(individual) {
    let score = 0;

    // Group genes by assignment
    const assignmentGroups = {};
    individual.genes.forEach(gene => {
      if (!assignmentGroups[gene.assignmentId]) {
        assignmentGroups[gene.assignmentId] = [];
      }
      assignmentGroups[gene.assignmentId].push(gene);
    });

    // For each course, prefer spread across different days
    Object.values(assignmentGroups).forEach(genes => {
      const uniqueDays = new Set(genes.map(g => g.dayIdx));
      score += uniqueDays.size * 15; // Bonus for multiple days

      // Bonus if spread across week
      const dayIndices = Array.from(uniqueDays).sort((a, b) => a - b);
      if (dayIndices.length > 1) {
        const spread = dayIndices[dayIndices.length - 1] - dayIndices[0];
        score += spread * 5;
      }
    });

    // Bonus for using different classrooms (resource efficiency)
    const uniqueClassrooms = new Set(individual.genes.map(g => g.classroomIdx));
    if (uniqueClassrooms.size >= Math.min(3, this.classrooms.length)) {
      score += 20;
    }

    return score;
  }

  /**
   * Tournament selection
   */
  tournamentSelection(population) {
    let best = null;
    for (let i = 0; i < this.tournamentSize; i++) {
      const idx = Math.floor(Math.random() * population.length);
      const candidate = population[idx];
      if (!best || candidate.fitness > best.fitness) {
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Crossover operation
   */
  crossover(parent1, parent2) {
    const child = {
      genes: [],
      fitness: 0,
      conflicts: 0
    };

    const point = Math.floor(parent1.genes.length / 2);

    for (let i = 0; i < parent1.genes.length; i++) {
      if (i < point) {
        child.genes.push(JSON.parse(JSON.stringify(parent1.genes[i])));
      } else {
        child.genes.push(JSON.parse(JSON.stringify(parent2.genes[i])));
      }
    }

    return child;
  }

  /**
   * Mutation operation
   */
  mutate(individual) {
    const mutant = {
      genes: individual.genes.map(g => JSON.parse(JSON.stringify(g))),
      fitness: individual.fitness,
      conflicts: individual.conflicts
    };

    mutant.genes.forEach(gene => {
      if (Math.random() < this.mutationRate) {
        const muteType = Math.floor(Math.random() * 3);

        switch (muteType) {
          case 0: // Change classroom
            gene.classroomIdx = Math.floor(Math.random() * this.classrooms.length);
            break;
          case 1: // Change day
            gene.dayIdx = Math.floor(Math.random() * this.daysOfWeek.length);
            break;
          case 2: // Change time slot
            gene.timeSlotIdx = Math.floor(Math.random() * this.timeSlots.length);
            break;
        }
      }
    });

    return mutant;
  }

  /**
   * Find standard by course ID
   */
  findStandardByCourseId(courseId) {
    for (let standard of this.standards) {
      if (standard.courses && standard.courses.some(c => c.id === courseId)) {
        return standard;
      }
    }
    return null;
  }
}

module.exports = GeneticAlgorithm;